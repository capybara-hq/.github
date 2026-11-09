import { appendFileSync, lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient, type GitHub } from "./github.ts";

/**
 * Resolves which pull request a completed `pr-event` run was about.
 *
 * Callers record the PR number in an unprivileged `pull_request` workflow named `pr-event` (it runs
 * the PR's own copy of that workflow, so its artifact is untrusted) and listen for it with
 * `workflow_run`, which runs this repository's code from the caller's default branch with a write
 * token. The number is accepted only when it is a plain integer, names a PR of this repository, and
 * that PR's head is the commit the run was for (`workflow_run.head_sha`, set by GitHub). Nothing
 * else from the run is read.
 */

/** Artifact the caller's `pr-event` workflow uploads, and the file inside it. */
export const PR_EVENT_ARTIFACT = "pr-event";
export const PR_EVENT_FILE = "number";
/** Larger artifact files are refused unread: a PR number is at most 10 digits. */
const MAX_FILE_BYTES = 64;

type RunPayload = {
  workflow_run?: { event?: string; conclusion?: string | null; head_sha?: string };
};

/** A PR number from untrusted text: digits only, no sign, no leading zero. */
export function parsePRNumber(text: string | null | undefined): number | null {
  const t = (text ?? "").trim();
  if (!/^[1-9][0-9]{0,9}$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) ? n : null;
}

/** Text of the number file in the downloaded artifact; null when it is missing, not a file or too big. */
export function readArtifact(dir: string): string | null {
  const path = join(dir, PR_EVENT_FILE);
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return null;
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

export type Resolution = { number: number } | { skip: string };

export async function resolvePREvent(
  gh: Pick<GitHub, "findPR">,
  repo: string,
  payload: unknown,
  artifact: string | null,
): Promise<Resolution> {
  const run = (payload as RunPayload).workflow_run;
  if (!run) return { skip: "the event has no workflow_run" };
  if (run.event !== "pull_request") return { skip: `the run was for a ${run.event} event` };
  if (run.conclusion !== "success") return { skip: `the run concluded ${run.conclusion}` };
  const headSha = run.head_sha ?? "";
  if (!/^[0-9a-f]{40}$/.test(headSha)) return { skip: "the run has no head SHA" };
  if (artifact === null) return { skip: `the run has no readable ${PR_EVENT_ARTIFACT} artifact` };
  const number = parsePRNumber(artifact);
  if (number === null) return { skip: "the recorded PR number is not an integer" };
  const pr = await gh.findPR(repo, number);
  if (!pr) return { skip: `#${number} is not a pull request of ${repo}` };
  if (pr.headSha !== headSha) {
    // A newer push moved the head; the run for that push evaluates it.
    return { skip: `#${number} head is ${pr.headSha}, not the run's ${headSha}` };
  }
  return { number };
}

if (import.meta.main) {
  const env = (name: string) => {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is not set`);
    return value;
  };
  const payload: unknown = JSON.parse(readFileSync(env("GITHUB_EVENT_PATH"), "utf8"));
  const gh = createClient({ token: env("GITHUB_TOKEN") });
  const result = await resolvePREvent(
    gh,
    env("GITHUB_REPOSITORY"),
    payload,
    readArtifact(env("PR_EVENT_DIR")),
  );
  if ("skip" in result) {
    console.log(`Skipped: ${result.skip}.`);
  } else {
    console.log(`Pull request #${result.number}.`);
    appendFileSync(env("GITHUB_OUTPUT"), `number=${result.number}\n`);
  }
}
