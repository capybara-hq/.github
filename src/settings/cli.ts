import { execFileSync } from "node:child_process";
import { createClient, type SettingsApi } from "../github.ts";
import { desired, TEAM_SLUG } from "./desired.ts";
import { type Actual, type Drift, diffSettings, preflight } from "./diff.ts";

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

  const reasons = preflight(have);
  if (reasons.length > 0) {
    for (const r of reasons) console.error(`refusing to apply: ${r}`);
    return 1;
  }
  const prune = flags.includes("--prune");
  for (const d of drift) {
    if (d.kind === "label") {
      await api.upsertLabel(repo, want.labels.find((l) => l.name === d.name)!);
    } else if (d.kind === "ruleset") {
      const rs = want.rulesets.find((r) => r.name === d.name)!;
      const existing = have.rulesets.find((r) => r.name === d.name);
      if (existing?.id !== undefined) await api.updateRuleset(repo, existing.id, rs);
      else await api.createRuleset(repo, rs);
    } else if (d.kind === "private-reporting") {
      await api.enablePrivateReporting(repo);
    } else if (d.kind === "unmanaged-ruleset") {
      const existing = have.rulesets.find((r) => r.name === d.name);
      if (!prune || existing?.id === undefined) {
        console.log(`left in place (use --prune to delete): ${d.name}`);
        continue;
      }
      await api.deleteRuleset(repo, existing.id);
    } else {
      console.log(`not written by this script: ${d.name} ${d.detail}`);
      continue;
    }
    console.log(`applied ${d.kind} ${d.name}`);
  }
  return 0;
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
