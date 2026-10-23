import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeFetch } from "../fake-fetch.ts";
import { createClient } from "../github.ts";

const API = "https://api.github.com";
const day = 24 * 60 * 60 * 1000;

test("listRecentStatuses skips PRs older than 30 days and returns the first match", async () => {
  const now = Date.now();
  const { fetch, calls } = fakeFetch({
    [`GET ${API}/repos/o/r/pulls?state=all&sort=updated&direction=desc&per_page=100`]: {
      body: [
        { updated_at: new Date(now - day).toISOString(), head: { sha: "a" } },
        { updated_at: new Date(now - 2 * day).toISOString(), head: { sha: "b" } },
        { updated_at: new Date(now - 40 * day).toISOString(), head: { sha: "old" } },
      ],
    },
    [`GET ${API}/repos/o/r/commits/a/statuses`]: { body: [{ context: "ci-ok", state: "success", created_at: "x" }] },
    [`GET ${API}/repos/o/r/commits/b/statuses`]: {
      body: [{ context: "issue-linked", state: "success", created_at: "y" }],
    },
  });
  const got = await createClient({ token: "t", fetch }).listRecentStatuses("o/r", "issue-linked");
  assert.deepEqual(got, [{ context: "issue-linked", state: "success", createdAt: "y" }]);
  assert.equal(calls.length, 3);
});

test("upsertLabel creates the label when the update finds none", async () => {
  const label = { name: "good first issue", color: "7057ff", description: "d" };
  const { fetch, calls } = fakeFetch({
    [`PATCH ${API}/repos/o/r/labels/good%20first%20issue`]: { status: 404 },
    [`POST ${API}/repos/o/r/labels`]: { status: 201, body: {} },
  });
  await createClient({ token: "t", fetch }).upsertLabel("o/r", label);
  assert.deepEqual(calls[1]!.body, label);
});
