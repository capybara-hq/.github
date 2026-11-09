import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fakeFetch } from "./fake-fetch.ts";
import { createClient } from "./github.ts";
import { parsePRNumber, readArtifact, resolvePREvent } from "./pr-event.ts";

const API = "https://api.github.com";
const REPO = "capybara-hq/core";
const SHA = "a".repeat(40);
const run = (over: Record<string, unknown> = {}) => ({
  workflow_run: { event: "pull_request", conclusion: "success", head_sha: SHA, ...over },
});
const rawPR = (n: number, sha = SHA) => ({
  number: n,
  body: "",
  state: "open",
  head: { sha },
  user: { login: "stranger", type: "User" },
});

test("parsePRNumber accepts only plain positive integers", () => {
  assert.equal(parsePRNumber("42\n"), 42);
  assert.equal(parsePRNumber(" 7 "), 7);
  for (const bad of ["", "0", "-1", "07", "1e3", "4.2", "42; rm -rf /", "12345678901", "0x10", null, undefined]) {
    assert.equal(parsePRNumber(bad), null, String(bad));
  }
});

test("readArtifact reads a small regular file and refuses symlinks and big files", () => {
  const dir = mkdtempSync(join(tmpdir(), "pr-event-"));
  assert.equal(readArtifact(dir), null);
  writeFileSync(join(dir, "number"), "12\n");
  assert.equal(readArtifact(dir), "12\n");

  const big = mkdtempSync(join(tmpdir(), "pr-event-"));
  writeFileSync(join(big, "number"), "1".repeat(65));
  assert.equal(readArtifact(big), null);

  const linked = mkdtempSync(join(tmpdir(), "pr-event-"));
  symlinkSync(join(dir, "number"), join(linked, "number"));
  assert.equal(readArtifact(linked), null);

  const nested = mkdtempSync(join(tmpdir(), "pr-event-"));
  mkdirSync(join(nested, "number"));
  assert.equal(readArtifact(nested), null);
});

function client(table: Parameters<typeof fakeFetch>[0]) {
  const f = fakeFetch(table);
  return { gh: createClient({ token: "t", fetch: f.fetch }), calls: f.calls };
}

test("resolvePREvent returns the number when the PR's head is the run's head", async () => {
  const { gh } = client({ [`GET ${API}/repos/${REPO}/pulls/5`]: { body: rawPR(5) } });
  assert.deepEqual(await resolvePREvent(gh, REPO, run(), "5\n"), { number: 5 });
});

test("resolvePREvent skips a PR whose head is not the run's head", async () => {
  const { gh } = client({ [`GET ${API}/repos/${REPO}/pulls/6`]: { body: rawPR(6, "b".repeat(40)) } });
  const result = await resolvePREvent(gh, REPO, run(), "6");
  assert.ok("skip" in result && /head/.test(result.skip));
});

test("resolvePREvent skips an unknown PR number", async () => {
  const { gh } = client({ [`GET ${API}/repos/${REPO}/pulls/9`]: { status: 404 } });
  const result = await resolvePREvent(gh, REPO, run(), "9");
  assert.ok("skip" in result && /not a pull request/.test(result.skip));
});

test("resolvePREvent never calls the API for untrusted or unfinished runs", async () => {
  const { gh, calls } = client({});
  const cases: [unknown, string | null][] = [
    [{}, "5"],
    [run({ event: "push" }), "5"],
    [run({ conclusion: "failure" }), "5"],
    [run({ head_sha: "not-a-sha" }), "5"],
    [run(), null],
    [run(), "5 && curl evil"],
    [run(), "../../etc/passwd"],
  ];
  for (const [payload, artifact] of cases) {
    const result = await resolvePREvent(gh, REPO, payload, artifact);
    assert.ok("skip" in result, JSON.stringify({ payload, artifact }));
  }
  assert.equal(calls.length, 0);
});
