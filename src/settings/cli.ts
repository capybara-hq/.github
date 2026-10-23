import { execFileSync } from "node:child_process";
import { createClient, type SettingsApi } from "../github.ts";
import { desired, TEAM_SLUG } from "./desired.ts";
import { type Actual, type Drift, diffSettings } from "./diff.ts";
import { ApplyError, applyDrift } from "./apply.ts";

async function gather(api: SettingsApi, repo: string): Promise<Actual> {
  const [labels, rulesets, codeowners, privateReporting, workflows, statuses] = await Promise.all([
    api.getLabels(repo),
    api.getRulesets(repo),
    api.getFile(repo, ".github/CODEOWNERS"),
    api.getPrivateReporting(repo),
    api.getWorkflows(repo),
    api.listRecentStatuses(repo, "issue-linked"),
  ]);
  return { labels, rulesets, codeowners, privateReporting, workflows, recentIssueLinked: statuses.length };
}

function token(): string {
  const env = process.env.GH_TOKEN;
  if (env) return env;
  return execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
}

const print = (drift: Drift[]) => {
  for (const d of drift) console.log(`${d.kind}\t${d.name}\t${d.detail}`);
};

export async function main(argv: string[]): Promise<number> {
  const [cmd, repo, ...flags] = argv;
  if ((cmd !== "check" && cmd !== "apply") || !repo?.includes("/")) {
    console.error("usage: cli.ts check <owner/repo> | apply <owner/repo> [--prune]");
    return 2;
  }
  const api = createClient({ token: token() });
  const org = repo.split("/")[0]!;
  const want = desired(await api.getTeamId(org, TEAM_SLUG));
  const have = await gather(api, repo);
  const drift = diffSettings(want, have);

  if (cmd === "check") {
    print(drift);
    if (drift.length === 0) console.log("no drift");
    return drift.length > 0 ? 1 : 0;
  }

  try {
    const { refused, steps } = await applyDrift(api, repo, want, have, drift, {
      prune: flags.includes("--prune"),
    });
    for (const r of refused) console.error(`refusing to apply: ${r}`);
    for (const st of steps) console.log(st);
    if (refused.length > 0) return 1;
  } catch (e) {
    if (!(e instanceof ApplyError)) throw e;
    for (const st of e.steps) console.log(st);
    console.error(`apply failed: ${e.message}; rerunning apply is safe`);
    return 1;
  }
  return 0;
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
