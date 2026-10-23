import { createHash } from "node:crypto";

export const SKILL_SOURCE = "capybara-hq/.github";
const COMMENT = "# Synced from capybara-hq/.github. Edit the source there, then run sync.";
const SHA_LINE = /^ {2}sha256: [0-9a-f]*$/;

export interface SkillFile {
  /** Relative to the skill directory, `/` separators. */
  path: string;
  content: string;
}

/** Deletes every `  sha256: <hex>` line (with its newline) inside the frontmatter only. */
function withoutShaLines(content: string): string {
  const match = /^---\n([\s\S]*?\n)?---(?=\n|$)/.exec(content);
  if (!match) return content;
  const kept = match[0].split("\n").filter((line) => !SHA_LINE.test(line));
  return kept.join("\n") + content.slice(match[0].length);
}

/**
 * Content hash of a skill directory (exact algorithm: hash-spec in the contributor-workflow
 * plan). CRLF is normalized to LF, files are sorted by path, and in SKILL.md the `sha256:`
 * lines of the frontmatter are ignored so that stamping does not change the hash.
 */
export function skillHash(files: SkillFile[]): string {
  const hash = createHash("sha256");
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const file of sorted) {
    const text = file.content.replaceAll("\r\n", "\n");
    hash.update(`${file.path}\0${file.path === "SKILL.md" ? withoutShaLines(text) : text}\0`);
  }
  return hash.digest("hex");
}

/**
 * Sets metadata.source / version / sha256 at the end of the frontmatter, keeping every other
 * line (and any other metadata keys) as they are.
 */
export function stampFrontmatter(skillMd: string, meta: { version: string; sha256: string }): string {
  const match = /^---\n([\s\S]*?)\n---(\n|$)/.exec(skillMd);
  if (!match) throw new Error("SKILL.md has no frontmatter block");
  const lines = match[1].split("\n");
  const values: [string, string][] = [
    ["source", SKILL_SOURCE],
    ["version", meta.version],
    ["sha256", meta.sha256],
  ];
  const start = lines.findIndex((line) => /^metadata:\s*$/.test(line));
  if (start === -1) {
    lines.push(COMMENT, "metadata:", ...values.map(([key, value]) => `  ${key}: ${value}`));
  } else {
    let end = start + 1;
    while (end < lines.length && /^\s+\S/.test(lines[end])) end++;
    const block = lines.slice(start + 1, end);
    for (const [key, value] of values) {
      const index = block.findIndex((line) => line.startsWith(`  ${key}:`));
      if (index === -1) block.push(`  ${key}: ${value}`);
      else block[index] = `  ${key}: ${value}`;
    }
    lines.splice(start + 1, end - start - 1, ...block);
    if (lines[start - 1] !== COMMENT) lines.splice(start, 0, COMMENT);
  }
  return `---\n${lines.join("\n")}\n---${match[2]}${skillMd.slice(match[0].length)}`;
}

/**
 * Stamps SKILL.md with the hash of the stamped directory. The hash ignores only the sha256
 * line, so the files are first stamped with an empty sha256, hashed, and stamped again.
 */
export function stampSkill(files: SkillFile[], version: string): { files: SkillFile[]; sha256: string } {
  const withEmpty = files.map((file) =>
    file.path === "SKILL.md" ? { ...file, content: stampFrontmatter(file.content, { version, sha256: "" }) } : file,
  );
  const sha256 = skillHash(withEmpty);
  const stamped = withEmpty.map((file) =>
    file.path === "SKILL.md" ? { ...file, content: stampFrontmatter(file.content, { version, sha256 }) } : file,
  );
  return { files: stamped, sha256 };
}
