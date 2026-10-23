import assert from "node:assert/strict";
import { test } from "node:test";
import { type Author, type IssueState, decideIssueLinked } from "./issue-linked.ts";

const repo = "capybara-hq/core";
const user = (permission: Author["permission"] = "none"): Author => ({
  login: "ann",
  type: "User",
  permission,
});
const issue = (over: Partial<IssueState> = {}): IssueState => ({
  number: 1,
  state: "open",
  labels: ["accepted"],
  assignees: [],
  ...over,
});
const run = (author: Author, body: string, issues: [number, IssueState | null][] = []) =>
  decideIssueLinked({ author, body, repo, issues: new Map(issues) });

test("write access is exempt", () => {
  for (const p of ["write", "maintain", "admin"] as const) {
    const r = run(user(p), "no link");
    assert.equal(r.state, "success");
    assert.equal(r.description, "Exempt: has write access");
    assert.equal(r.comment, null);
  }
});

test("allowlisted bot is exempt, other bots are treated like users", () => {
  const bot = (login: string): Author => ({ login, type: "Bot", permission: "none" });
  assert.equal(run(bot("dependabot[bot]"), "").state, "success");
  assert.equal(run(bot("some-app[bot]"), "").state, "failure");
});

test("unknown permission fails", () => {
  const r = run(user("unknown"), "Closes #1", [[1, issue()]]);
  assert.equal(r.state, "failure");
  assert.match(r.description, /^Could not read the author's permission/);
});

test("no references explains how to link", () => {
  const r = run(user(), "just a change");
  assert.equal(r.state, "failure");
  assert.match(r.comment ?? "", /Closes #<number>/);
  assert.match(r.comment ?? "", /\/claim/);
  assert.ok(r.description.length <= 140);
});

test("missing issue", () => {
  const r = run(user(), "Closes #9", [[9, null]]);
  assert.equal(r.state, "failure");
  assert.match(r.description, /#9 not found/);
});

test("closed issue", () => {
  const r = run(user(), "Closes #1", [[1, issue({ state: "closed" })]]);
  assert.equal(r.state, "failure");
  assert.match(r.description, /closed/);
});

test("open but not accepted", () => {
  const r = run(user(), "Closes #1", [[1, issue({ labels: ["needs-triage"] })]]);
  assert.equal(r.state, "failure");
  assert.match(r.description, /not accepted yet/);
});

test("good first issue, unassigned, passes", () => {
  const r = run(user(), "Closes #1", [[1, issue({ labels: ["good first issue"] })]]);
  assert.equal(r.state, "success");
  assert.equal(r.comment, null);
});

test("assigned to someone else fails and names them", () => {
  const r = run(user(), "Closes #1", [[1, issue({ assignees: ["bob"] })]]);
  assert.equal(r.state, "failure");
  assert.match(r.description, /@bob/);
  assert.match(r.comment ?? "", /@bob/);
});

test("assigned to the author passes", () => {
  const r = run(user(), "Closes #1", [[1, issue({ assignees: ["ann"] })]]);
  assert.equal(r.state, "success");
});

test("one qualifying issue among several is enough", () => {
  const r = run(user(), "Closes #1, closes #2", [
    [1, issue({ state: "closed" })],
    [2, issue({ number: 2 })],
  ]);
  assert.equal(r.state, "success");
});

test("description stays within the status API limit", () => {
  const issues: [number, IssueState | null][] = [];
  let body = "";
  for (let n = 1; n <= 12; n++) {
    issues.push([n, null]);
    body += `Closes #${n}\n`;
  }
  assert.ok(run(user(), body, issues).description.length <= 140);
});
