import assert from "node:assert/strict";
import { test } from "node:test";
import { checkIssueFormat } from "./issue-format.ts";

const bug = (what: string) =>
  `### What happened\n\n${what}\n\n### Steps to reproduce\n\ny\n\n### Expected behavior\n\nz\n\n### Version or commit\n\nv1`;

test("complete bug report is ok", () => {
  assert.deepEqual(checkIssueFormat(bug("x")), { ok: true, missing: [] });
});

test("complete feature request is ok", () => {
  assert.equal(checkIssueFormat("### Problem\n\na\n\n### Proposed solution\n\nb").ok, true);
});

test("_No response_ in a required section counts as missing", () => {
  assert.deepEqual(checkIssueFormat(bug("_No response_")), {
    ok: false,
    missing: ["What happened"],
  });
});

test("free text reports the feature form's required sections", () => {
  assert.deepEqual(checkIssueFormat("it is broken, please fix"), {
    ok: false,
    missing: ["Problem", "Proposed solution"],
  });
});
