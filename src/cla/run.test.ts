import assert from "node:assert/strict";
import { test } from "node:test";
import { type Handler, fakeFetch } from "../fake-fetch.ts";
import { createClient } from "../github.ts";
import { DEFAULT_SIGN_PHRASE } from "./cla.ts";
import { type ClaConfig, runCla } from "./run.ts";

const API = "https://api.github.com";
const REPO = "capybara-hq/core";
const FILE = `${API}/repos/${REPO}/contents/signatures/v1/cla.json`;
const CONFIG: ClaConfig = {
  allowlist: "grant-chao,dependabot[bot]",
  documentUrl: "https://github.com/capybara-hq/core/blob/main/CLA.md",
  phrase: DEFAULT_SIGN_PHRASE,
  branch: "cla-signatures",
  path: "signatures/v1/cla.json",
};
const payload = (extra: Record<string, unknown> = {}) => ({ repository: { id: 7 }, ...extra });
const rawPR = (n: number, state = "open") => ({
  number: n,
  body: "",
  state,
  head: { sha: `sha${n}` },
  user: { login: "alice", type: "User" },
});
const commits = (...users: { login: string; databaseId: number }[]) => ({
  data: {
    repository: {
      pullRequest: {
        commits: {
          nodes: users.map((user) => ({ commit: { author: { name: user.login, user }, committer: null } })),
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    },
  },
});
const stored = (signedContributors: unknown[]) => ({
  content: Buffer.from(JSON.stringify({ signedContributors })).toString("base64"),
  encoding: "base64",
  sha: "blob1",
});
const comments = (n: number) => `${API}/repos/${REPO}/issues/${n}/comments?per_page=100`;
const signComment = { id: 99, body: DEFAULT_SIGN_PHRASE, user: { login: "alice", id: 10 }, created_at: "t1" };

function setup(table: Record<string, Handler>) {
  const f = fakeFetch(table);
  return { gh: createClient({ token: "t", fetch: f.fetch }), calls: f.calls };
}

test("an unsigned contributor gets a failure status and the instructions comment", async () => {
  const { gh, calls } = setup({
    [`GET ${API}/repos/${REPO}/pulls/5`]: { body: rawPR(5) },
    [`POST ${API}/graphql`]: { body: commits({ login: "alice", databaseId: 10 }) },
    [`GET ${comments(5)}`]: { body: [] },
    [`GET ${FILE}?ref=cla-signatures`]: { body: stored([]) },
    [`POST ${API}/repos/${REPO}/statuses/sha5`]: { status: 201 },
    [`POST ${API}/repos/${REPO}/issues/5/comments`]: { status: 201 },
  });
  await runCla({ name: "workflow_run", payload: payload(), repo: REPO, prNumber: 5 }, gh, CONFIG);
  const status = calls.find((c) => c.key.includes("/statuses/"))?.body as Record<string, string>;
  assert.deepEqual(status, { state: "failure", description: "Not signed yet: alice", context: "cla" });
  const posted = calls.at(-1)?.body as { body: string };
  assert.ok(posted.body.startsWith("<!-- capybara-gate:cla -->\n"));
  assert.ok(posted.body.includes(DEFAULT_SIGN_PHRASE));
});

test("the signing comment records the signature, turns the status green and updates the comment", async () => {
  let written: { content: string; sha: string; branch: string; message: string } | undefined;
  const { gh, calls } = setup({
    [`GET ${API}/repos/${REPO}/pulls/5`]: { body: rawPR(5) },
    [`POST ${API}/graphql`]: { body: commits({ login: "alice", databaseId: 10 }, { login: "grant-chao", databaseId: 1 }) },
    [`GET ${comments(5)}`]: {
      body: [{ id: 50, body: "<!-- capybara-gate:cla -->\nold", user: { login: "github-actions[bot]", id: 41898282 }, created_at: "t0" }, signComment],
    },
    [`GET ${FILE}?ref=cla-signatures`]: { body: stored([]) },
    [`GET ${API}/repos/${REPO}/git/ref/heads/cla-signatures`]: { body: { object: { sha: "c1" } } },
    [`PUT ${FILE}`]: ({ body }) => {
      written = body as typeof written;
      return { status: 200, body: {} };
    },
    [`POST ${API}/repos/${REPO}/statuses/sha5`]: { status: 201 },
    [`PATCH ${API}/repos/${REPO}/issues/comments/50`]: { status: 200 },
  });
  await runCla(
    {
      name: "issue_comment",
      payload: payload({ action: "created", issue: { number: 5, pull_request: {} }, comment: { body: DEFAULT_SIGN_PHRASE } }),
      repo: REPO,
      prNumber: null,
    },
    gh,
    CONFIG,
  );
  assert.equal(written?.branch, "cla-signatures");
  assert.equal(written?.sha, "blob1");
  assert.equal(written?.message, `@alice signed the CLA in ${REPO}#5`);
  assert.deepEqual(JSON.parse(Buffer.from(written!.content, "base64").toString()), {
    signedContributors: [{ name: "alice", id: 10, comment_id: 99, created_at: "t1", repoId: 7, pullRequestNo: 5 }],
  });
  const status = calls.find((c) => c.key.includes("/statuses/"))?.body as Record<string, string>;
  assert.equal(status.state, "success");
  const edited = calls.find((c) => c.key.startsWith("PATCH"))?.body as { body: string };
  assert.match(edited.body, /All contributors have signed the CLA/);
});

test("a stale signature file is re-read and the write retried", async () => {
  let puts = 0;
  const { gh } = setup({
    [`GET ${API}/repos/${REPO}/pulls/5`]: { body: rawPR(5) },
    [`POST ${API}/graphql`]: { body: commits({ login: "alice", databaseId: 10 }) },
    [`GET ${comments(5)}`]: { body: [signComment] },
    [`GET ${FILE}?ref=cla-signatures`]: { body: stored([]) },
    [`GET ${API}/repos/${REPO}/git/ref/heads/cla-signatures`]: { body: {} },
    [`PUT ${FILE}`]: () => (++puts === 1 ? { status: 409 } : { status: 200, body: {} }),
    [`POST ${API}/repos/${REPO}/statuses/sha5`]: { status: 201 },
  });
  await runCla(
    {
      name: "issue_comment",
      payload: payload({ action: "created", issue: { number: 5, pull_request: {} }, comment: { body: "recheck" } }),
      repo: REPO,
      prNumber: null,
    },
    gh,
    CONFIG,
  );
  assert.equal(puts, 2);
});

test("a missing signatures branch is created as an orphan holding the file", async () => {
  const { gh, calls } = setup({
    [`GET ${API}/repos/${REPO}/pulls/5`]: { body: rawPR(5) },
    [`POST ${API}/graphql`]: { body: commits({ login: "alice", databaseId: 10 }) },
    [`GET ${comments(5)}`]: { body: [signComment] },
    [`GET ${FILE}?ref=cla-signatures`]: { status: 404 },
    [`GET ${API}/repos/${REPO}/git/ref/heads/cla-signatures`]: { status: 404 },
    [`POST ${API}/repos/${REPO}/git/blobs`]: { status: 201, body: { sha: "b" } },
    [`POST ${API}/repos/${REPO}/git/trees`]: { status: 201, body: { sha: "t" } },
    [`POST ${API}/repos/${REPO}/git/commits`]: { status: 201, body: { sha: "c" } },
    [`POST ${API}/repos/${REPO}/git/refs`]: { status: 201, body: { ref: "refs/heads/cla-signatures" } },
    [`POST ${API}/repos/${REPO}/statuses/sha5`]: { status: 201 },
  });
  await runCla(
    {
      name: "issue_comment",
      payload: payload({ action: "created", issue: { number: 5, pull_request: {} }, comment: { body: DEFAULT_SIGN_PHRASE } }),
      repo: REPO,
      prNumber: null,
    },
    gh,
    CONFIG,
  );
  const commit = calls.find((c) => c.key.endsWith("/git/commits"))?.body as { parents: string[] };
  assert.deepEqual(commit.parents, []);
  const ref = calls.find((c) => c.key.endsWith("/git/refs"))?.body as { ref: string; sha: string };
  assert.deepEqual(ref, { ref: "refs/heads/cla-signatures", sha: "c" });
});

test("allowlisted authors pass without a comment", async () => {
  const { gh, calls } = setup({
    [`GET ${API}/repos/${REPO}/pulls/5`]: { body: rawPR(5) },
    [`POST ${API}/graphql`]: { body: commits({ login: "grant-chao", databaseId: 1 }) },
    [`GET ${FILE}?ref=cla-signatures`]: { body: stored([]) },
    [`POST ${API}/repos/${REPO}/statuses/sha5`]: { status: 201 },
    [`GET ${comments(5)}`]: { body: [] },
  });
  await runCla({ name: "workflow_run", payload: payload(), repo: REPO, prNumber: 5 }, gh, CONFIG);
  const status = calls.find((c) => c.key.includes("/statuses/"))?.body as Record<string, string>;
  assert.equal(status.state, "success");
  assert.ok(!calls.some((c) => c.key.startsWith("POST") && c.key.includes("/comments")));
});

test("a closed PR is locked and not checked", async () => {
  const { gh, calls } = setup({
    [`GET ${API}/repos/${REPO}/pulls/5`]: { body: rawPR(5, "closed") },
    [`PUT ${API}/repos/${REPO}/issues/5/lock`]: { status: 204 },
  });
  await runCla({ name: "workflow_run", payload: payload(), repo: REPO, prNumber: 5 }, gh, CONFIG);
  assert.deepEqual(
    calls.map((c) => c.key),
    [`GET ${API}/repos/${REPO}/pulls/5`, `PUT ${API}/repos/${REPO}/issues/5/lock`],
  );
});

test("other comments, issue comments and runs without a validated number do nothing", async () => {
  const { gh, calls } = setup({});
  const comment = (body: string, pull_request?: unknown) =>
    payload({ action: "created", issue: { number: 5, pull_request }, comment: { body } });
  await runCla({ name: "issue_comment", payload: comment("lgtm", {}), repo: REPO, prNumber: null }, gh, CONFIG);
  await runCla({ name: "issue_comment", payload: comment("recheck"), repo: REPO, prNumber: null }, gh, CONFIG);
  await runCla({ name: "workflow_run", payload: payload(), repo: REPO, prNumber: null }, gh, CONFIG);
  await runCla({ name: "pull_request_target", payload: payload(), repo: REPO, prNumber: 5 }, gh, CONFIG);
  assert.equal(calls.length, 0);
});
