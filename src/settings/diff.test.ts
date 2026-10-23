import assert from "node:assert/strict";
import { test } from "node:test";
import { desired, GATE_WORKFLOW } from "./desired.ts";
import { type Actual, diffSettings, preflight } from "./diff.ts";

const want = desired(42);

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

const matching = (): Actual => ({
  labels: clone(want.labels),
  rulesets: clone(want.rulesets).map((r, i) => ({ ...r, id: i + 1 })),
  codeowners: "* @capybara-hq/maintainers\n",
  privateReporting: true,
  workflows: [`uses: ${GATE_WORKFLOW}@v1`],
  recentIssueLinked: 3,
});

test("no drift when actual equals desired", () => {
  assert.deepEqual(diffSettings(want, matching()), []);
});

test("extra fields GitHub adds are ignored", () => {
  const have = matching();
  for (const r of have.rulesets) {
    r.source = "capybara-hq/core";
    r.created_at = "2026-10-23T00:00:00Z";
    for (const rule of r.rules as { parameters?: Record<string, unknown> }[]) {
      if (rule.parameters) rule.parameters.required_reviewers = [];
    }
  }
  have.labels[0]!.color = have.labels[0]!.color.toUpperCase();
  (have.labels[0] as Record<string, unknown>).id = 9;
  assert.deepEqual(diffSettings(want, have), []);
});

test("a changed approval count is ruleset drift", () => {
  const have = matching();
  const review = have.rulesets.find((r) => r.name === "main-review")!;
  (review.rules as { parameters: { required_approving_review_count: number } }[])[0]!.parameters
    .required_approving_review_count = 0;
  const drift = diffSettings(want, have);
  assert.equal(drift.length, 1);
  assert.equal(drift[0]!.kind, "ruleset");
  assert.equal(drift[0]!.name, "main-review");
  assert.match(drift[0]!.detail, /required_approving_review_count/);
});

test("protect-main is unmanaged-ruleset drift", () => {
  const have = matching();
  have.rulesets.push({ id: 25335593, name: "protect-main", rules: [] });
  assert.deepEqual(diffSettings(want, have), [
    { kind: "unmanaged-ruleset", name: "protect-main", detail: "not managed by the settings script" },
  ]);
});

test("missing team in CODEOWNERS is drift", () => {
  const have = matching();
  have.codeowners = "* @someone-else\n";
  assert.equal(diffSettings(want, have)[0]?.kind, "codeowners");
  have.codeowners = null;
  assert.equal(diffSettings(want, have)[0]?.detail, "missing");
});

test("preflight refuses without the gate workflow", () => {
  const have = matching();
  assert.deepEqual(preflight(have), []);
  have.workflows = ["name: ci\non: push\n"];
  const reasons = preflight(have);
  assert.equal(reasons.length, 1);
  assert.match(reasons[0]!, /gate\.yml/);
});

test("preflight refuses without a recent issue-linked status", () => {
  const have = matching();
  have.recentIssueLinked = 0;
  const reasons = preflight(have);
  assert.equal(reasons.length, 1);
  assert.match(reasons[0]!, /issue-linked/);
});
