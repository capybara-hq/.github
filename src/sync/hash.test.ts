import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { type SkillFile, skillHash, stampFrontmatter, stampSkill } from "./hash.ts";

const FIXTURE_SHA256 = "cef1a6784ece247858b9144b07a58ac47ffa8c51520e2b1d817421a3d73090dd";
const STAMPED_FIXTURE_SHA256 = "7571c66c01170d67878bb2d691f6c7980ae762412c65e1a602077baa2f9b5a4b";
const fixtureDir = new URL("./fixtures/skill/", import.meta.url);
const fixture = (): SkillFile[] =>
  ["SKILL.md", "extra.md"].map((path) => ({ path, content: readFileSync(new URL(path, fixtureDir), "utf8") }));

const stampedDir = new URL("./fixtures/stamped/", import.meta.url);
const stampedFixture = (): SkillFile[] =>
  ["SKILL.md", "extra.md"].map((path) => ({ path, content: readFileSync(new URL(path, stampedDir), "utf8") }));

const stamped = (sha256: string): SkillFile[] =>
  fixture().map((f) => (f.path === "SKILL.md" ? { ...f, content: stampFrontmatter(f.content, { version: "v1.0.0", sha256 }) } : f));

test("hash ignores the sha256 line", () => {
  assert.equal(skillHash(stamped("")), skillHash(stamped("abc123")));
});

test("hash changes when any file changes", () => {
  const base = skillHash(fixture());
  const changed = fixture().map((f) => (f.path === "extra.md" ? { ...f, content: `${f.content}x` } : f));
  assert.notEqual(skillHash(changed), base);
  const renamed = fixture().map((f) => (f.path === "extra.md" ? { ...f, path: "other.md" } : f));
  assert.notEqual(skillHash(renamed), base);
  const body = fixture().map((f) => (f.path === "SKILL.md" ? { ...f, content: `${f.content}x` } : f));
  assert.notEqual(skillHash(body), base);
});

test("hash is independent of file order", () => {
  assert.equal(skillHash(fixture()), skillHash(fixture().reverse()));
});

test("stamp then hash round-trips", () => {
  const { files, sha256 } = stampSkill(fixture(), "v1.2.3");
  assert.equal(skillHash(files), sha256);
  const skillMd = files.find((f) => f.path === "SKILL.md")?.content ?? "";
  assert.match(skillMd, /^ {2}sha256: [0-9a-f]{64}$/m);
  assert.match(skillMd, /^ {2}source: capybara-hq\/\.github$/m);
  assert.match(skillMd, /^ {2}version: v1\.2\.3$/m);
});

test("stamping keeps existing lines and replaces an existing metadata block", () => {
  const original = fixture()[0].content;
  const once = stampFrontmatter(original, { version: "v1.0.0", sha256: "aa" });
  for (const line of original.split("\n").slice(0, 4)) assert.ok(once.includes(`${line}\n`));
  assert.match(once, /description: .*\n# Synced from [^\n]*\nmetadata:\n/);
  const withExtra = once.replace("metadata:\n", "metadata:\n  owner: someone\n");
  const twice = stampFrontmatter(withExtra, { version: "v1.1.0", sha256: "bb" });
  assert.match(twice, /^ {2}owner: someone$/m);
  assert.match(twice, /^ {2}version: v1\.1\.0$/m);
  assert.match(twice, /^ {2}sha256: bb$/m);
  assert.equal(twice.match(/^metadata:/gm)?.length, 1);
  assert.equal(twice.match(/^# Synced from/gm)?.length, 1);
});

test("a sha256-looking line in the body does not break the fixed point", () => {
  const files = fixture().map((f) => (f.path === "SKILL.md" ? { ...f, content: `${f.content}\n  sha256: abc\n` } : f));
  const result = stampSkill(files, "v1.0.0");
  assert.equal(skillHash(result.files), result.sha256);
  assert.ok(result.files[0].content.includes("\n  sha256: abc\n"));
});

test("a CRLF copy of a stamped skill hashes to its recorded sha256", () => {
  const { files, sha256 } = stampSkill(fixture(), "v1.0.0");
  const crlf = files.map((f) => ({ ...f, content: f.content.replaceAll("\n", "\r\n") }));
  assert.equal(skillHash(crlf), sha256);
});

test("stamped fixture hash equals STAMPED_FIXTURE_SHA256 and its recorded sha256", () => {
  const files = stampedFixture();
  const recorded = /^ {2}sha256: ([0-9a-f]+)$/m.exec(files[0].content)?.[1];
  assert.equal(skillHash(files), STAMPED_FIXTURE_SHA256);
  assert.equal(recorded, STAMPED_FIXTURE_SHA256);
  assert.deepEqual(stampSkill(fixture(), "v1.0.0").files, files);
});

test("fixture hash equals FIXTURE_SHA256", () => {
  assert.equal(skillHash(fixture()), FIXTURE_SHA256);
});

test("cli copies a tagged skill, stamps it, and removes stale files", () => {
  const cli = new URL("./cli.ts", import.meta.url).pathname;
  const repo = mkdtempSync(join(tmpdir(), "sync-src-"));
  const target = mkdtempSync(join(tmpdir(), "sync-dst-"));
  const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  git("init", "-q");
  mkdirSync(join(repo, "skills/demo"), { recursive: true });
  writeFileSync(join(repo, "skills/demo/SKILL.md"), '---\nname: demo\ndescription: "Demo skill."\n---\n\n# Demo\n');
  writeFileSync(join(repo, "skills/demo/extra.md"), "extra\n");
  git("add", ".");
  git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", "init");
  git("tag", "v0.0.1");
  // A local edit after the tag must not leak.
  writeFileSync(join(repo, "skills/demo/extra.md"), "edited after tag\n");

  const stale = join(target, ".agents/skills/demo/stale.md");
  mkdirSync(join(target, ".agents/skills/demo"), { recursive: true });
  writeFileSync(stale, "old\n");

  const run = (version: string, to: string) =>
    spawnSync("node", [cli, "--to", to, "--version", version], { cwd: repo, encoding: "utf8" });

  const missing = mkdtempSync(join(tmpdir(), "sync-none-"));
  const bad = run("v9.9.9", missing);
  assert.notEqual(bad.status, 0);
  assert.deepEqual(readdirSync(missing), []);

  const ok = run("v0.0.1", target);
  assert.equal(ok.status, 0, ok.stderr);
  const dir = join(target, ".agents/skills/demo");
  assert.equal(existsSync(stale), false);
  assert.equal(readFileSync(join(dir, "extra.md"), "utf8"), "extra\n");
  const skillMd = readFileSync(join(dir, "SKILL.md"), "utf8");
  assert.match(skillMd, /^ {2}version: v0\.0\.1$/m);
  const files = ["SKILL.md", "extra.md"].map((path) => ({ path, content: readFileSync(join(dir, path), "utf8") }));
  assert.equal(/^ {2}sha256: ([0-9a-f]{64})$/m.exec(skillMd)?.[1], skillHash(files));
  assert.ok(skillMd.startsWith('---\nname: demo\ndescription: "Demo skill."\n'));
});
