import assert from "node:assert/strict";
import { test } from "node:test";
import { closingRefs } from "./refs.ts";

const repo = "capybara-hq/core";

test("plain closing keyword", () => {
  assert.deepEqual(closingRefs("Closes #12", repo), [12]);
});

test("qualified same-repo reference and issue URL", () => {
  assert.deepEqual(
    closingRefs(
      "fixes capybara-hq/core#7 and resolves https://github.com/capybara-hq/core/issues/8",
      repo,
    ),
    [7, 8],
  );
});

test("other repository does not count", () => {
  assert.deepEqual(closingRefs("Closes other/repo#3", repo), []);
  assert.deepEqual(closingRefs("Closes https://github.com/other/repo/issues/3", repo), []);
});

test("reference without a keyword does not count", () => {
  assert.deepEqual(closingRefs("See #12", repo), []);
});

test("deduplicates and is case-insensitive", () => {
  assert.deepEqual(closingRefs("CLOSES #5, closes #5", repo), [5]);
});

test("keeps order across several references", () => {
  assert.deepEqual(closingRefs("Fixed #9\nResolved: #2\nclose #9", repo), [9, 2]);
});
