import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const SKILLS = ["onboarding", "contributing", "reviewing-prs"];
const ALLOWED_COMMANDS = ["pnpm doctor", "pnpm verify", "pnpm wt:new"];

const read = (name: string): string => readFileSync(new URL(`skills/${name}/SKILL.md`, root), "utf8");

/** Top-level `key: value` pairs of the YAML frontmatter (single-line values only). */
function frontmatter(text: string): Record<string, string> {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  assert.ok(match, "SKILL.md starts with a --- frontmatter block");
  const fields: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const pair = /^([a-z][\w-]*):\s*(.*)$/.exec(line);
    if (pair) fields[pair[1]] = pair[2].replace(/^["']|["']$/g, "");
  }
  return fields;
}

test("every skill has matching name and a description under 1024 chars", () => {
  for (const name of SKILLS) {
    const fields = frontmatter(read(name));
    assert.equal(fields.name, name, `${name}: frontmatter name matches the directory`);
    assert.ok(fields.description, `${name}: has a description`);
    assert.ok(fields.description.length <= 1024, `${name}: description is ${fields.description.length} chars`);
  }
});

test("no skill mentions a repository-specific command other than pnpm doctor, pnpm verify, pnpm wt:new", () => {
  for (const name of SKILLS) {
    const commands = read(name).match(/pnpm [a-z:-]+/g) ?? [];
    const others = commands.filter((c) => !ALLOWED_COMMANDS.includes(c));
    assert.deepEqual(others, [], `${name}: mentions ${others.join(", ")}`);
  }
});
