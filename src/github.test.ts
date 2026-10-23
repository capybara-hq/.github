import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeFetch } from "./fake-fetch.ts";
import { createClient } from "./github.ts";

const API = "https://api.github.com";

test("listOpenPRs follows Link next across 3 pages", async () => {
  const pr = (n: number) => ({
    number: n,
    body: null,
    state: "open",
    head: { sha: `sha${n}` },
    user: { login: "u", type: "User" },
  });
  const p1 = `${API}/repos/o/r/pulls?state=open&per_page=100`;
  const p2 = `${API}/repos/o/r/pulls?state=open&per_page=100&page=2`;
  const p3 = `${API}/repos/o/r/pulls?state=open&per_page=100&page=3`;
  const { fetch, calls } = fakeFetch({
    [`GET ${p1}`]: { body: [pr(1), pr(2)], headers: { link: `<${p2}>; rel="next", <${p3}>; rel="last"` } },
    [`GET ${p2}`]: { body: [pr(3)], headers: { link: `<${p3}>; rel="next"` } },
    [`GET ${p3}`]: { body: [pr(4)] },
  });
  const gh = createClient({ token: "t", fetch });
  const numbers: number[] = [];
  for await (const p of gh.listOpenPRs("o/r")) numbers.push(p.number);
  assert.deepEqual(numbers, [1, 2, 3, 4]);
  assert.equal(calls.length, 3);
});

test("getPermission maps 404 to none and 502 to unknown", async () => {
  const { fetch } = fakeFetch({
    [`GET ${API}/repos/o/r/collaborators/stranger/permission`]: { status: 404 },
    [`GET ${API}/repos/o/r/collaborators/flaky/permission`]: { status: 502 },
    [`GET ${API}/repos/o/r/collaborators/denied/permission`]: { status: 403 },
    [`GET ${API}/repos/o/r/collaborators/maint/permission`]: {
      body: { permission: "write", role_name: "maintain" },
    },
    [`GET ${API}/repos/o/r/collaborators/reader/permission`]: { body: { permission: "read" } },
  });
  const gh = createClient({ token: "t", fetch });
  assert.equal(await gh.getPermission("o/r", "stranger"), "none");
  assert.equal(await gh.getPermission("o/r", "flaky"), "unknown");
  assert.equal(await gh.getPermission("o/r", "denied"), "unknown");
  assert.equal(await gh.getPermission("o/r", "maint"), "maintain");
  assert.equal(await gh.getPermission("o/r", "reader"), "read");
  const down = createClient({
    token: "t",
    fetch: (async () => {
      throw new Error("network down");
    }) as typeof fetch,
  });
  assert.equal(await down.getPermission("o/r", "x"), "unknown");
});

test("upsertComment edits the marked comment instead of adding one", async () => {
  const list = `${API}/repos/o/r/issues/7/comments?per_page=100`;
  const { fetch, calls } = fakeFetch({
    [`GET ${list}`]: {
      body: [
        { id: 1, body: "unrelated" },
        { id: 2, body: "<!-- capybara-gate:issue-linked -->\nold text" },
      ],
    },
    [`PATCH ${API}/repos/o/r/issues/comments/2`]: {},
  });
  const gh = createClient({ token: "t", fetch });
  await gh.upsertComment("o/r", 7, "issue-linked", "new text");
  assert.deepEqual(
    calls.map((c) => c.key),
    [`GET ${list}`, `PATCH ${API}/repos/o/r/issues/comments/2`],
  );
  assert.equal(calls[1]?.body && (calls[1].body as { body: string }).body, "<!-- capybara-gate:issue-linked -->\nnew text");
});

test("upsertComment creates when absent and deletes on null", async () => {
  const list = `${API}/repos/o/r/issues/7/comments?per_page=100`;
  const created = fakeFetch({
    [`GET ${list}`]: { body: [] },
    [`POST ${list.replace("?per_page=100", "")}`]: { status: 201 },
  });
  await createClient({ token: "t", fetch: created.fetch }).upsertComment("o/r", 7, "m", "hi");
  assert.equal(created.calls.length, 2);

  const none = fakeFetch({ [`GET ${list}`]: { body: [] } });
  await createClient({ token: "t", fetch: none.fetch }).upsertComment("o/r", 7, "m", null);
  assert.equal(none.calls.length, 1);

  const del = fakeFetch({
    [`GET ${list}`]: { body: [{ id: 9, body: "<!-- capybara-gate:m -->\nx" }] },
    [`DELETE ${API}/repos/o/r/issues/comments/9`]: { status: 204 },
  });
  await createClient({ token: "t", fetch: del.fetch }).upsertComment("o/r", 7, "m", null);
  assert.equal(del.calls.length, 2);
});

test("getIssue returns null on 404 and throws naming method, path and status otherwise", async () => {
  const { fetch } = fakeFetch({
    [`GET ${API}/repos/o/r/issues/1`]: { status: 404 },
    [`GET ${API}/repos/o/r/issues/2`]: { status: 500 },
    [`GET ${API}/repos/o/r/issues/3`]: {
      body: { number: 3, state: "open", labels: [{ name: "accepted" }], assignees: [{ login: "a" }] },
    },
    [`GET ${API}/repos/o/r/issues/4`]: { body: { number: 4, state: "open", labels: [], assignees: [], pull_request: {} } },
  });
  const gh = createClient({ token: "t", fetch });
  assert.equal(await gh.getIssue("o/r", 1), null);
  await assert.rejects(gh.getIssue("o/r", 2), /GET \/repos\/o\/r\/issues\/2.*500/);
  assert.deepEqual(await gh.getIssue("o/r", 3), {
    number: 3,
    state: "open",
    labels: ["accepted"],
    assignees: ["a"],
  });
  assert.equal(await gh.getIssue("o/r", 4), null);
});
