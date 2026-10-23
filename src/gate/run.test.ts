import assert from "node:assert/strict";
import { test } from "node:test";
import { type Handler, fakeFetch } from "../fake-fetch.ts";
import { createClient } from "../github.ts";
import { runGate } from "./run.ts";

const API = "https://api.github.com";
const REPO = "capybara-hq/core";
const comments = (n: number) => `${API}/repos/${REPO}/issues/${n}/comments?per_page=100`;
const rawPR = (n: number, body: string, login = "stranger") => ({
  number: n,
  body,
  state: "open",
  head: { sha: `sha${n}` },
  user: { login, type: "User" },
});
const issue = (n: number, labels: string[], assignees: string[] = []) => ({
  number: n,
  state: "open",
  labels: labels.map((name) => ({ name })),
  assignees: assignees.map((login) => ({ login })),
});

function setup(table: Record<string, Handler>) {
  const f = fakeFetch(table);
  return { gh: createClient({ token: "t", fetch: f.fetch }), calls: f.calls };
}

test("pull_request_target sets failure status and comments", async () => {
  const { gh, calls } = setup({
    [`GET ${API}/repos/${REPO}/pulls/5`]: { body: rawPR(5, "No link here") },
    [`GET ${API}/repos/${REPO}/collaborators/stranger/permission`]: { status: 404 },
    [`POST ${API}/repos/${REPO}/statuses/sha5`]: { status: 201 },
    [`GET ${comments(5)}`]: { body: [] },
    [`POST ${API}/repos/${REPO}/issues/5/comments`]: { status: 201 },
  });
  await runGate({ name: "pull_request_target", payload: { action: "opened", number: 5 }, repo: REPO }, gh);
  const status = calls.find((c) => c.key.includes("/statuses/"))?.body as Record<string, string>;
  assert.equal(status.state, "failure");
  assert.equal(status.context, "issue-linked");
  const comment = calls.at(-1)?.body as { body: string };
  assert.ok(comment.body.startsWith("<!-- capybara-gate:issue-linked -->"));
});

test("labeling an issue accepted re-evaluates the PR that closes it and deletes the gate comment", async () => {
  const { gh, calls } = setup({
    [`GET ${API}/repos/${REPO}/pulls?state=open&per_page=100`]: {
      body: [rawPR(5, "Closes #12"), rawPR(6, "Unrelated")],
    },
    [`GET ${API}/repos/${REPO}/collaborators/stranger/permission`]: { body: { permission: "read" } },
    [`GET ${API}/repos/${REPO}/issues/12`]: { body: issue(12, ["accepted"]) },
    [`POST ${API}/repos/${REPO}/statuses/sha5`]: { status: 201 },
    [`GET ${comments(5)}`]: { body: [{ id: 77, body: "<!-- capybara-gate:issue-linked -->\nold" }] },
    [`DELETE ${API}/repos/${REPO}/issues/comments/77`]: { status: 204 },
  });
  await runGate(
    { name: "issues", payload: { action: "labeled", issue: { number: 12 } }, repo: REPO },
    gh,
  );
  const status = calls.find((c) => c.key.includes("/statuses/"))?.body as Record<string, string>;
  assert.equal(status.state, "success");
  assert.ok(calls.some((c) => c.key.startsWith("DELETE ")));
  assert.ok(!calls.some((c) => c.key.includes("sha6")));
});

const ISSUE_URL = `${API}/repos/${REPO}/issues/20`;
const openedPayload = (action: string, body: string, labels: string[] = []) => ({
  action,
  issue: { number: 20, body, user: { login: "stranger", type: "User" }, labels: labels.map((name) => ({ name })) },
});

test("issues opened without sections adds needs-info and comments once; edited with sections removes needs-info", async () => {
  const perm = { [`GET ${API}/repos/${REPO}/collaborators/stranger/permission`]: { status: 404 } };
  const opened = setup({
    ...perm,
    [`POST ${ISSUE_URL}/labels`]: { body: [] },
    [`GET ${comments(20)}`]: { body: [] },
    [`POST ${ISSUE_URL}/comments`]: { status: 201 },
  });
  await runGate({ name: "issues", payload: openedPayload("opened", "just a vague idea"), repo: REPO }, opened.gh);
  assert.deepEqual(opened.calls.find((c) => c.key.endsWith("/labels"))?.body, { labels: ["needs-info"] });
  assert.equal(opened.calls.filter((c) => c.key === `POST ${ISSUE_URL}/comments`).length, 1);
  const text = (opened.calls.at(-1)?.body as { body: string }).body;
  assert.ok(text.startsWith("<!-- capybara-gate:issue-format -->"));

  const full = "### What happened\n\nIt broke\n\n### Steps to reproduce\n\n1. run\n\n### Expected behavior\n\nWorks\n\n### Version or commit\n\n1.0";
  const edited = setup({
    ...perm,
    [`DELETE ${ISSUE_URL}/labels/needs-info`]: { body: [] },
    [`GET ${comments(20)}`]: { body: [{ id: 3, body: "<!-- capybara-gate:issue-format -->\nold" }] },
    [`DELETE ${API}/repos/${REPO}/issues/comments/3`]: { status: 204 },
  });
  await runGate(
    { name: "issues", payload: openedPayload("edited", full, ["needs-info"]), repo: REPO },
    edited.gh,
  );
  assert.ok(edited.calls.some((c) => c.key === `DELETE ${ISSUE_URL}/labels/needs-info`));
  assert.ok(edited.calls.some((c) => c.key.startsWith("DELETE ") && c.key.endsWith("/comments/3")));
});

test("/claim on an accepted unassigned issue assigns the commenter", async () => {
  const { gh, calls } = setup({
    [`GET ${ISSUE_URL}`]: { body: issue(20, ["accepted"]) },
    [`POST ${ISSUE_URL}/assignees`]: { status: 201 },
    [`POST ${ISSUE_URL}/comments`]: { status: 201 },
  });
  await runGate(
    {
      name: "issue_comment",
      payload: { action: "created", issue: { number: 20 }, comment: { body: "/claim\nthanks", user: { login: "dev" } } },
      repo: REPO,
    },
    gh,
  );
  assert.deepEqual(calls.find((c) => c.key.endsWith("/assignees"))?.body, { assignees: ["dev"] });
  const reply = (calls.at(-1)?.body as { body: string }).body;
  assert.ok(reply.startsWith("<!-- capybara-gate:claim -->"));
});

test("issue_comment on a PR is ignored", async () => {
  const { gh, calls } = setup({});
  await runGate(
    {
      name: "issue_comment",
      payload: {
        action: "created",
        issue: { number: 20, pull_request: {} },
        comment: { body: "/claim", user: { login: "dev" } },
      },
      repo: REPO,
    },
    gh,
  );
  assert.equal(calls.length, 0);
});

test("a permission lookup failure for a PR author fails the status without a comment", async () => {
  const { gh, calls } = setup({
    [`GET ${API}/repos/${REPO}/pulls/5`]: { body: rawPR(5, "Closes #12") },
    [`GET ${API}/repos/${REPO}/collaborators/stranger/permission`]: { status: 502 },
    [`GET ${API}/repos/${REPO}/issues/12`]: { body: issue(12, ["accepted"]) },
    [`POST ${API}/repos/${REPO}/statuses/sha5`]: { status: 201 },
    [`GET ${comments(5)}`]: { body: [] },
  });
  await runGate({ name: "pull_request_target", payload: { action: "edited", number: 5 }, repo: REPO }, gh);
  const status = calls.find((c) => c.key.includes("/statuses/"))?.body as Record<string, string>;
  assert.equal(status.state, "failure");
  assert.match(status.description, /permission/);
  assert.ok(!calls.some((c) => c.key === `POST ${API}/repos/${REPO}/issues/5/comments`));
});

test("pull_request_target evaluates the API's current head SHA and body, not the payload's", async () => {
  const { gh, calls } = setup({
    [`GET ${API}/repos/${REPO}/pulls/5`]: { body: { ...rawPR(5, "Closes #12"), head: { sha: "newsha" } } },
    [`GET ${API}/repos/${REPO}/collaborators/stranger/permission`]: { body: { permission: "read" } },
    [`GET ${API}/repos/${REPO}/issues/12`]: { body: issue(12, ["accepted"]) },
    [`POST ${API}/repos/${REPO}/statuses/newsha`]: { status: 201 },
    [`GET ${comments(5)}`]: { body: [] },
  });
  await runGate(
    {
      name: "pull_request_target",
      payload: { action: "synchronize", number: 5, pull_request: { body: "stale, no link", head: { sha: "oldsha" } } },
      repo: REPO,
    },
    gh,
  );
  const status = calls.find((c) => c.key.includes("/statuses/"));
  assert.equal(status?.key, `POST ${API}/repos/${REPO}/statuses/newsha`);
  assert.equal((status?.body as { state: string }).state, "success");
});
