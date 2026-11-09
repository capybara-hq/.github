import { readFileSync } from "node:fs";
import { type ClaApi, createClient, type GitHub, markerOf } from "../github.ts";
import { parsePRNumber } from "../pr-event.ts";
import {
  claComment,
  claStatus,
  committersToCheck,
  decideCla,
  RECHECK,
  type SignatureFile,
} from "./cla.ts";

export type ClaConfig = {
  allowlist: string;
  documentUrl: string;
  phrase: string;
  /** Branch and path of the signature file in the calling repository. */
  branch: string;
  path: string;
};

type ClaEvent = {
  name: string;
  payload: unknown;
  repo: string;
  /** For `workflow_run`: the PR number already validated by src/pr-event.ts. */
  prNumber: number | null;
};

type Payload = {
  action?: string;
  repository?: { id: number };
  issue?: { number: number; pull_request?: unknown };
  comment?: { body?: string | null };
};

type Api = Pick<GitHub, "getPR" | "setStatus" | "addComment"> & ClaApi;

const MARKER = "cla";
const MAX_WRITE_ATTEMPTS = 3;

function parseFile(text: string | undefined): SignatureFile {
  if (text === undefined) return { signedContributors: [] };
  const parsed = JSON.parse(text) as Partial<SignatureFile>;
  if (!Array.isArray(parsed.signedContributors)) throw new Error("signature file has no signedContributors array");
  return { signedContributors: parsed.signedContributors };
}

/** Checks every committer of the open PR, records new comment signatures, and reports. */
async function check(gh: Api, repo: string, n: number, repoId: number, config: ClaConfig): Promise<void> {
  const pr = await gh.getPR(repo, n);
  const committers = committersToCheck(await gh.listCommitters(repo, n), config.allowlist);
  const comments = committers.length > 0 ? await gh.listComments(repo, n) : [];

  const decide = (file: SignatureFile) =>
    decideCla({ committers, file, comments, phrase: config.phrase, repoId, pr: n });

  let decision: ReturnType<typeof decide>;
  for (let attempt = 1; ; attempt++) {
    const stored = await gh.getBranchFile(repo, config.branch, config.path);
    const file = parseFile(stored?.text);
    decision = decide(file);
    if (decision.newSignatures.length === 0) break;
    const names = decision.newSignatures.map((s) => `@${s.name}`).join(", ");
    const written = await gh.putBranchFile(repo, config.branch, config.path, {
      text: `${JSON.stringify({ signedContributors: [...file.signedContributors, ...decision.newSignatures] }, null, 2)}\n`,
      sha: stored?.sha ?? null,
      message: `${names} signed the CLA in ${repo}#${n}`,
    });
    if (written) break;
    if (attempt >= MAX_WRITE_ATTEMPTS) throw new Error(`could not write ${config.path}: it kept changing`);
  }

  const status = claStatus(decision);
  await gh.setStatus(repo, pr.headSha, { ...status, context: "cla" });

  // Like the contributor-assistant action: comment only once someone has to sign, then keep that
  // comment current (it turns into a short "all signed" note).
  const body = claComment(decision, config);
  const text = `${markerOf(MARKER)}\n${body}`;
  const existing = await gh.findMarkedComment(repo, n, MARKER);
  if (existing) {
    if (existing.body !== text) await gh.editComment(repo, existing.id, text);
  } else if (decision.notSigned.length > 0) {
    await gh.addComment(repo, n, MARKER, body);
  }
}

export async function runCla(event: ClaEvent, gh: Api, config: ClaConfig): Promise<void> {
  const payload = event.payload as Payload;
  const repoId = payload.repository?.id;
  if (repoId === undefined) throw new Error("the event payload has no repository id");

  switch (event.name) {
    case "workflow_run": {
      if (event.prNumber === null) return;
      const pr = await gh.getPR(event.repo, event.prNumber);
      if (pr.state === "closed") {
        // Lock the conversation so signature comments stay as they were when the PR closed.
        await gh.lockIssue(event.repo, pr.number);
        return;
      }
      await check(gh, event.repo, pr.number, repoId, config);
      return;
    }
    case "issue_comment": {
      const { issue, comment } = payload;
      if (payload.action !== "created" || !issue?.pull_request) return;
      const text = (comment?.body ?? "").trim().toLowerCase();
      if (text !== RECHECK && text !== config.phrase.trim().toLowerCase()) return;
      const pr = await gh.getPR(event.repo, issue.number);
      if (pr.state !== "open") return;
      await check(gh, event.repo, pr.number, repoId, config);
      return;
    }
    default:
      return;
  }
}

if (import.meta.main) {
  const env = (name: string) => {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is not set`);
    return value;
  };
  const payload: unknown = JSON.parse(readFileSync(env("GITHUB_EVENT_PATH"), "utf8"));
  const gh = createClient({ token: env("GITHUB_TOKEN") });
  await runCla(
    {
      name: env("GITHUB_EVENT_NAME"),
      payload,
      repo: env("GITHUB_REPOSITORY"),
      prNumber: parsePRNumber(process.env.PR_NUMBER),
    },
    gh,
    {
      allowlist: process.env.CLA_ALLOWLIST ?? "",
      documentUrl: env("CLA_DOCUMENT_URL"),
      phrase: env("CLA_SIGN_PHRASE"),
      branch: env("CLA_BRANCH"),
      path: env("CLA_PATH"),
    },
  );
}
