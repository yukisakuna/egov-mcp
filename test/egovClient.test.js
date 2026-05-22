import test from "node:test";
import assert from "node:assert/strict";
import { categoryCode, normalizeDate } from "../src/egovClient.js";

test("normalizeDate accepts compact and dashed dates", () => {
  assert.equal(normalizeDate("20260417"), "20260417");
  assert.equal(normalizeDate("2026-04-17"), "20260417");
});

test("categoryCode maps public law API categories", () => {
  assert.equal(categoryCode("all"), "1");
  assert.equal(categoryCode("acts"), "2");
  assert.equal(categoryCode("orders"), "3");
  assert.equal(categoryCode("ministerial_orders"), "4");
});
