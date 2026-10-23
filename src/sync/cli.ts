import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { type SkillFile, stampSkill } from "./hash.ts";

const git = (args: string[]): string => execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

function listFiles(dir: string, prefix = ""): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? listFiles(join(dir, entry.name), `${prefix}${entry.name}/`) : [`${prefix}${entry.name}`],
  );
}

function main(): void {
  const { values } = parseArgs({ options: { to: { type: "string" }, version: { type: "string" } } });
  if (!values.to || !values.version) throw new Error("usage: node src/sync/cli.ts --to <repo path> --version <tag>");
  const { to, version } = values;
  try {
    git(["rev-parse", "--verify", "--quiet", `refs/tags/${version}^{commit}`]);
  } catch {
    throw new Error(`tag ${version} does not exist`);
  }

  // Read everything from the tag first so that nothing is written if any read fails.
  const paths = git(["ls-tree", "-r", "--name-only", version, "skills/"]).split("\n").filter(Boolean);
  const skills = new Map<string, SkillFile[]>();
  for (const path of paths) {
    const [, name, ...rest] = path.split("/");
    const files = skills.get(name) ?? [];
    files.push({ path: rest.join("/"), content: git(["show", `${version}:${path}`]) });
    skills.set(name, files);
  }
  for (const [name, files] of skills) {
    if (!files.some((file) => file.path === "SKILL.md")) throw new Error(`skill ${name} has no SKILL.md`);
  }

  for (const [name, files] of skills) {
    const { files: stamped, sha256 } = stampSkill(files, version);
    const target = join(to, ".agents", "skills", name);
    const wanted = new Set(stamped.map((file) => file.path));
    const stale = existsSync(target) ? listFiles(target).filter((file) => !wanted.has(file)) : [];
    for (const file of stale) {
      rmSync(join(target, file));
      console.log(`removed ${name}/${file}`);
    }
    for (const file of stamped) {
      const dest = join(target, file.path);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, file.content);
    }
    console.log(`synced ${name} (${stamped.length} files, ${version}, sha256 ${sha256.slice(0, 12)})`);
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
