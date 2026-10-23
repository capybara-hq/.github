import type { SettingsApi } from "../github.ts";
import type { Desired } from "./desired.ts";
import { type Actual, type Drift, preflight } from "./diff.ts";

export class ApplyError extends Error {
  readonly steps: string[];
  constructor(steps: string[], cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.steps = steps;
  }
}

export type ApplyResult = { refused: string[]; steps: string[] };

/**
 * Pass 1 writes labels, managed rulesets and private reporting. Pass 2 deletes unmanaged
 * rulesets, only with `prune` and only after pass 1 fully succeeded, so `main` is never
 * left less protected. Preflight runs before any write; reasons mean no write at all.
 * CODEOWNERS is reported, never written. A failure throws ApplyError with the steps done.
 */
export async function applyDrift(
  api: SettingsApi,
  repo: string,
  want: Desired,
  have: Actual,
  drift: Drift[],
  opts: { prune: boolean },
): Promise<ApplyResult> {
  const refused = preflight(have);
  if (refused.length > 0) return { refused, steps: [] };

  const steps: string[] = [];
  try {
    for (const d of drift.filter((x) => x.kind === "label")) {
      await api.upsertLabel(repo, want.labels.find((l) => l.name === d.name)!);
      steps.push(`label ${d.name}`);
    }
    for (const d of drift.filter((x) => x.kind === "ruleset")) {
      const rs = want.rulesets.find((r) => r.name === d.name)!;
      const id = have.rulesets.find((r) => r.name === d.name)?.id;
      if (id !== undefined) await api.updateRuleset(repo, id, rs);
      else await api.createRuleset(repo, rs);
      steps.push(`ruleset ${d.name}`);
    }
    if (drift.some((x) => x.kind === "private-reporting")) {
      await api.enablePrivateReporting(repo);
      steps.push("private-reporting");
    }
    for (const d of drift.filter((x) => x.kind === "unmanaged-ruleset")) {
      const id = have.rulesets.find((r) => r.name === d.name)?.id;
      if (!opts.prune || id === undefined) {
        steps.push(`left in place (use --prune to delete): ${d.name}`);
        continue;
      }
      await api.deleteRuleset(repo, id);
      steps.push(`deleted ruleset ${d.name}`);
    }
  } catch (e) {
    throw new ApplyError(steps, e);
  }
  for (const d of drift.filter((x) => x.kind === "codeowners")) {
    steps.push(`not written by this script: ${d.name} ${d.detail}`);
  }
  return { refused: [], steps };
}
