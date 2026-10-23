import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { FORM_SECTIONS } from "./gate/forms.ts";

const root = new URL("../", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, root), "utf8");

type Field = { type: string; label: string; required: boolean };

/** Minimal reader for the issue form shape: `body:` items with `type:`, `attributes.label:` and `validations.required:`. */
function parseBody(yaml: string): Field[] {
  const lines = yaml.split("\n");
  const start = lines.findIndex((l) => l === "body:");
  assert.notEqual(start, -1, "form has a body:");
  const fields: Field[] = [];
  let current: Field | undefined;
  for (const line of lines.slice(start + 1)) {
    const item = /^ {2}- type:\s*(\S+)/.exec(line);
    if (item) {
      current = { type: item[1], label: "", required: false };
      fields.push(current);
      continue;
    }
    if (!current) continue;
    const label = /^ {6}label:\s*(.+?)\s*$/.exec(line);
    if (label) current.label = label[1].replace(/^["']|["']$/g, "");
    const required = /^ {6}required:\s*(true|false)\s*$/.exec(line);
    if (required) current.required = required[1] === "true";
  }
  return fields;
}

for (const kind of ["bug", "feature"] as const) {
  test(`${kind} form lists exactly FORM_SECTIONS`, () => {
    const fields = parseBody(read(`.github/ISSUE_TEMPLATE/${kind}.yml`)).filter((f) => f.type !== "markdown");
    assert.deepEqual(
      fields.map(({ label, required }) => ({ label, required })),
      FORM_SECTIONS[kind],
    );
  });

  test(`${kind} form applies needs-triage`, () => {
    const yaml = read(`.github/ISSUE_TEMPLATE/${kind}.yml`);
    const labels = /^labels:\s*\[(.*)\]\s*$/m.exec(yaml);
    assert.ok(labels, "labels: [..] present");
    const list = labels[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, ""));
    assert.deepEqual(list, ["needs-triage", kind === "bug" ? "bug" : "enhancement"]);
  });
}

test("config disables blank issues and links security advisories", () => {
  const yaml = read(".github/ISSUE_TEMPLATE/config.yml");
  assert.match(yaml, /^blank_issues_enabled:\s*false\s*$/m);
  assert.match(yaml, /name:\s*Report a security vulnerability/);
  assert.match(yaml, /url:\s*https:\/\/github\.com\/capybara-hq\/core\/security\/advisories\/new/);
});

test("community files exist and carry the contact", () => {
  assert.match(read("CODE_OF_CONDUCT.md"), /284885069@qq\.com/);
  assert.doesNotMatch(read("CODE_OF_CONDUCT.md"), /INSERT CONTACT METHOD/);
  assert.match(read("SECURITY.md"), /284885069@qq\.com/);
  assert.match(read("CONTRIBUTING.md"), /## Supported agents/);
  assert.match(read(".github/pull_request_template.md"), /Closes #/);
});
