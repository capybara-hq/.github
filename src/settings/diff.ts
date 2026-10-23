import type { Label, Ruleset } from "../github.ts";
import { GATE_WORKFLOW, type Desired } from "./desired.ts";

export type Actual = {
  labels: Label[];
  rulesets: Ruleset[];
  /** Text of `.github/CODEOWNERS`, null when missing. */
  codeowners: string | null;
  privateReporting: boolean;
  /** Text of each file under `.github/workflows`. */
  workflows: string[];
  /** Statuses named `issue-linked` seen on PR heads in the last 30 days. */
  recentIssueLinked: number;
};

export type Drift = {
  kind: "label" | "ruleset" | "unmanaged-ruleset" | "codeowners" | "private-reporting";
  name: string;
  detail: string;
};

/** True when everything `want` sets is present in `have`; extra fields in `have` are ignored. */
function covers(want: unknown, have: unknown): boolean {
  if (Array.isArray(want)) {
    if (!Array.isArray(have) || want.length !== have.length) return false;
    const pool = [...have];
    for (const w of want) {
      const i = pool.findIndex((h) => covers(w, h));
      if (i < 0) return false;
      pool.splice(i, 1);
    }
    return true;
  }
  if (want !== null && typeof want === "object") {
    if (have === null || typeof have !== "object" || Array.isArray(have)) return false;
    return Object.entries(want).every(([k, v]) => covers(v, (have as Record<string, unknown>)[k]));
  }
  return want === have;
}

/** First field path where `want` is not covered, for the drift message. */
function firstMismatch(want: unknown, have: unknown, path: string): string {
  if (want !== null && typeof want === "object" && !Array.isArray(want)) {
    for (const [k, v] of Object.entries(want)) {
      const h = have !== null && typeof have === "object" ? (have as Record<string, unknown>)[k] : undefined;
      if (!covers(v, h)) return firstMismatch(v, h, path ? `${path}.${k}` : k);
    }
  }
  return `${path || "ruleset"}: want ${JSON.stringify(want)}, have ${JSON.stringify(have ?? null)}`;
}

export function diffSettings(want: Desired, have: Actual): Drift[] {
  const drift: Drift[] = [];

  for (const label of want.labels) {
    const found = have.labels.find((l) => l.name === label.name);
    if (!found) {
      drift.push({ kind: "label", name: label.name, detail: "missing" });
    } else if (found.color.toLowerCase() !== label.color || found.description !== label.description) {
      drift.push({ kind: "label", name: label.name, detail: "color or description differs" });
    }
  }

  for (const rs of want.rulesets) {
    const found = have.rulesets.find((r) => r.name === rs.name);
    if (!found) drift.push({ kind: "ruleset", name: rs.name, detail: "missing" });
    else if (!covers(rs, found)) {
      drift.push({ kind: "ruleset", name: rs.name, detail: firstMismatch(rs, found, "") });
    }
  }
  for (const r of have.rulesets) {
    if (!want.rulesets.some((w) => w.name === r.name)) {
      drift.push({ kind: "unmanaged-ruleset", name: r.name, detail: "not managed by the settings script" });
    }
  }

  if (have.codeowners === null) {
    drift.push({ kind: "codeowners", name: ".github/CODEOWNERS", detail: "missing" });
  } else if (!have.codeowners.includes(want.codeownersMention)) {
    drift.push({
      kind: "codeowners",
      name: ".github/CODEOWNERS",
      detail: `does not mention ${want.codeownersMention}`,
    });
  }

  if (!have.privateReporting) {
    drift.push({ kind: "private-reporting", name: "private vulnerability reporting", detail: "disabled" });
  }
  return drift;
}

/** Reasons not to apply rulesets yet; empty means safe. */
export function preflight(have: Actual): string[] {
  const reasons: string[] = [];
  if (!have.workflows.some((w) => w.includes(GATE_WORKFLOW))) {
    reasons.push(`no workflow in .github/workflows uses ${GATE_WORKFLOW}`);
  }
  if (have.recentIssueLinked === 0) {
    reasons.push(
      "no issue-linked status was set on this repository in the last 30 days; requiring it would block every merge",
    );
  }
  return reasons;
}
