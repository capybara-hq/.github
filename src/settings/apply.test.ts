import assert from "node:assert/strict";
import { test } from "node:test";
import type { SettingsApi } from "../github.ts";
import { ApplyError, applyDrift } from "./apply.ts";
import { desired, GATE_WORKFLOW } from "./desired.ts";
import { type Actual, diffSettings } from "./diff.ts";

const want = desired(42);

const have = (over: Partial<Actual> = {}): Actual => ({
  labels: [],
  rulesets: [{ id: 7, name: "protect-main", rules: [] }],
  codeowners: null,
  privateReporting: false,
  workflows: [`uses: ${GATE_WORKFLOW}@v1`],
  recentIssueLinked: 1,
  ...over,
});

function fakeApi(failCreateOn?: number) {
  const calls: string[] = [];
  let creates = 0;
  const rec = (name: string) => async (...args: unknown[]) => {
    calls.push(`${name}`);
    void args;
  };
  const api = {
    upsertLabel: rec("upsertLabel"),
    updateRuleset: rec("updateRuleset"),
    deleteRuleset: rec("deleteRuleset"),
    enablePrivateReporting: rec("enablePrivateReporting"),
    async createRuleset() {
      calls.push("createRuleset");
      if (++creates === failCreateOn) throw new Error("boom");
    },
  } as unknown as SettingsApi;
  return { api, calls };
}

test("a failing createRuleset stops before any delete and propagates", async () => {
  const h = have();
  const { api, calls } = fakeApi(2);
  await assert.rejects(
    applyDrift(api, "o/r", want, h, diffSettings(want, h), { prune: true }),
    (e) => e instanceof ApplyError && e.message === "boom" && e.steps.includes("ruleset main-quality"),
  );
  assert.ok(!calls.includes("deleteRuleset"));
});

test("without prune nothing is deleted", async () => {
  const h = have();
  const { api, calls } = fakeApi();
  const r = await applyDrift(api, "o/r", want, h, diffSettings(want, h), { prune: false });
  assert.ok(!calls.includes("deleteRuleset"));
  assert.ok(r.steps.some((s) => s.startsWith("left in place")));
});

test("preflight reasons mean zero write calls", async () => {
  const h = have({ workflows: [], recentIssueLinked: 0 });
  const { api, calls } = fakeApi();
  const r = await applyDrift(api, "o/r", want, h, diffSettings(want, h), { prune: true });
  assert.equal(r.refused.length, 2);
  assert.deepEqual(calls, []);
});

test("drift in a shuffled order still deletes last", async () => {
  const h = have();
  const drift = diffSettings(want, h).reverse();
  const { api, calls } = fakeApi();
  await applyDrift(api, "o/r", want, h, drift, { prune: true });
  assert.equal(calls.at(-1), "deleteRuleset");
  assert.equal(calls.filter((c) => c === "deleteRuleset").length, 1);
  assert.ok(calls.indexOf("deleteRuleset") > calls.lastIndexOf("createRuleset"));
});
