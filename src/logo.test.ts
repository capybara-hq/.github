import assert from "node:assert/strict";
import { test } from "node:test";
import { CAPYBARA_BITMAP, logoSvg } from "../scripts/logo-svg.ts";

test("logoSvg draws one square per X", () => {
  const svg = logoSvg({ cell: 10, fill: "#FF6A13" });
  const filled = CAPYBARA_BITMAP.join("").split("X").length - 1;
  assert.ok(filled > 0);
  assert.ok(svg.includes('viewBox="0 0 140 100"'));
  assert.ok(svg.includes('shape-rendering="crispEdges"'));
  assert.equal(svg.split("h10v10h-10z").length - 1, filled);
  assert.ok(svg.includes('fill="#FF6A13"'));
});
