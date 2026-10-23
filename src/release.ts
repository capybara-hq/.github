import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/**
 * Tags to create for a package.json version: the immutable `v<version>` and the moving
 * `v<major>`. Returns [] when `v<version>` already exists: a released version is never
 * retagged, and the major tag only moves together with a new version.
 */
export function releaseTags(version: string, existing: string[]): string[] {
  const match = SEMVER.exec(version);
  if (!match) throw new Error(`version "${version}" is not semver (expected MAJOR.MINOR.PATCH)`);
  if (existing.includes(`v${version}`)) return [];
  return [`v${version}`, `v${match[1]}`];
}

if (import.meta.main) {
  const { version } = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
  const existing = execFileSync("git", ["tag", "--list"], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
  for (const tag of releaseTags(version, existing)) console.log(tag);
}
