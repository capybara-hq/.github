import assert from "node:assert/strict";
import { test } from "node:test";
import { decideClaim, parseClaim } from "./claim.ts";

test("parseClaim accepts /claim on the first line", () => {
  assert.equal(parseClaim("/claim"), true);
  assert.equal(parseClaim("  /claim  \nthanks"), true);
});

test("parseClaim rejects look-alikes", () => {
  assert.equal(parseClaim("I will /claim this"), false);
  assert.equal(parseClaim("> /claim"), false);
  assert.equal(parseClaim("thanks\n/claim"), false);
  assert.equal(parseClaim("/claimed"), false);
});

const issue = (over: Partial<Parameters<typeof decideClaim>[0]["issue"]> = {}) => ({
  number: 4,
  state: "open" as const,
  labels: ["accepted"],
  assignees: [] as string[],
  ...over,
});

test("unassigned accepted issue is assigned", () => {
  assert.equal(decideClaim({ commenter: "ann", issue: issue() }).action, "assign");
  assert.equal(
    decideClaim({ commenter: "ann", issue: issue({ labels: ["help wanted"] }) }).action,
    "assign",
  );
});

test("already assigned to the commenter", () => {
  const r = decideClaim({ commenter: "ann", issue: issue({ assignees: ["Ann"] }) });
  assert.equal(r.action, "reply");
  assert.match(r.message, /already assigned to you/);
});

test("assigned to someone else names them", () => {
  const r = decideClaim({ commenter: "ann", issue: issue({ assignees: ["bob"] }) });
  assert.equal(r.action, "reply");
  assert.match(r.message, /@bob/);
});

test("not accepted issue cannot be claimed", () => {
  const r = decideClaim({ commenter: "ann", issue: issue({ labels: ["needs-triage"] }) });
  assert.equal(r.action, "reply");
  assert.match(r.message, /not accepted yet/);
});
