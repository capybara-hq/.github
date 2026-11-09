import assert from "node:assert/strict";
import { test } from "node:test";
import type { IssueComment } from "../github.ts";
import {
  claComment,
  claStatus,
  committersToCheck,
  DEFAULT_SIGN_PHRASE,
  decideCla,
  isAllowlisted,
  isSignComment,
} from "./cla.ts";

const comment = (over: Partial<IssueComment>): IssueComment => ({
  id: 1,
  body: DEFAULT_SIGN_PHRASE,
  login: "alice",
  userId: 10,
  createdAt: "2026-11-10T00:00:00Z",
  ...over,
});

test("isAllowlisted matches whole names and * wildcards", () => {
  const list = "grant-chao, dependabot[bot],changeset-bot*";
  assert.ok(isAllowlisted("grant-chao", list));
  assert.ok(isAllowlisted("dependabot[bot]", list));
  assert.ok(isAllowlisted("changeset-bot[bot]", list));
  assert.ok(!isAllowlisted("grant", list));
  assert.ok(!isAllowlisted("xdependabot[bot]", list));
  assert.ok(!isAllowlisted("anyone", ""));
});

test("committersToCheck dedupes by name and drops github-actions[bot] and the allowlist", () => {
  const got = committersToCheck(
    [
      { name: "alice", id: 10 },
      { name: "alice", id: 10 },
      { name: "github-actions[bot]", id: 41898282 },
      { name: "grant-chao", id: 1 },
      { name: "Some Name", id: null },
    ],
    "grant-chao",
  );
  assert.deepEqual(got, [
    { name: "alice", id: 10 },
    { name: "Some Name", id: null },
  ]);
});

test("isSignComment ignores case and surrounding space, but not other text or the bot", () => {
  assert.ok(isSignComment(comment({ body: `  ${DEFAULT_SIGN_PHRASE.toUpperCase()}\n` }), DEFAULT_SIGN_PHRASE));
  assert.ok(!isSignComment(comment({ body: `${DEFAULT_SIGN_PHRASE}, maybe` }), DEFAULT_SIGN_PHRASE));
  assert.ok(!isSignComment(comment({ login: "github-actions[bot]" }), DEFAULT_SIGN_PHRASE));
});

test("decideCla: signed on file, signed by comment now, not signed, unknown", () => {
  const d = decideCla({
    committers: [
      { name: "alice", id: 10 },
      { name: "bob", id: 20 },
      { name: "carol", id: 30 },
      { name: "Nobody", id: null },
    ],
    file: {
      signedContributors: [
        { name: "alice", id: 10, comment_id: 5, created_at: "x", repoId: 1, pullRequestNo: 1 },
      ],
    },
    comments: [
      comment({ id: 99, login: "bob", userId: 20 }),
      // Someone who is not a committer signing does not count for anyone.
      comment({ id: 100, login: "mallory", userId: 66 }),
    ],
    phrase: DEFAULT_SIGN_PHRASE,
    repoId: 7,
    pr: 42,
  });
  assert.deepEqual(
    d.signed.map((c) => c.name),
    ["alice", "bob"],
  );
  assert.deepEqual(
    d.notSigned.map((c) => c.name),
    ["carol", "Nobody"],
  );
  assert.deepEqual(
    d.unknown.map((c) => c.name),
    ["Nobody"],
  );
  assert.deepEqual(d.newSignatures, [
    { name: "bob", id: 20, comment_id: 99, created_at: "2026-11-10T00:00:00Z", repoId: 7, pullRequestNo: 42 },
  ]);
  const status = claStatus(d);
  assert.equal(status.state, "failure");
  assert.equal(status.description, "Not signed yet: carol, Nobody");
  const text = claComment(d, { documentUrl: "https://example.com/CLA.md", phrase: DEFAULT_SIGN_PHRASE });
  assert.match(text, /\*\*2\*\* out of \*\*4\*\*/);
  assert.match(text, /:x: @carol/);
  assert.match(text, /\*\*Nobody\*\* seems not to be a GitHub user/);
  assert.ok(text.includes(`\`\`\`\n${DEFAULT_SIGN_PHRASE}\n\`\`\``));
});

test("decideCla with nobody to check is all signed", () => {
  const d = decideCla({
    committers: [],
    file: { signedContributors: [] },
    comments: [],
    phrase: DEFAULT_SIGN_PHRASE,
    repoId: 7,
    pr: 1,
  });
  assert.deepEqual(claStatus(d), { state: "success", description: "All contributors have signed the CLA" });
  assert.match(claComment(d, { documentUrl: "u", phrase: DEFAULT_SIGN_PHRASE }), /All contributors have signed/);
});
