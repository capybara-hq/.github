import assert from "node:assert/strict";
import { test } from "node:test";
import { releaseTags } from "./release.ts";

test("new version gets its tag and the major tag", () => {
  assert.deepEqual(releaseTags("1.2.3", ["v1.2.2", "v1"]), ["v1.2.3", "v1"]);
  assert.deepEqual(releaseTags("2.0.0", []), ["v2.0.0", "v2"]);
});

test("existing version gets nothing", () => {
  assert.deepEqual(releaseTags("1.0.0", ["v1.0.0", "v1"]), []);
});

test("rejects a non-semver version", () => {
  for (const bad of ["1.0", "v1.0.0", "1.0.0-beta.1", "", "1.0.x"]) {
    assert.throws(() => releaseTags(bad, []), /semver/);
  }
});
