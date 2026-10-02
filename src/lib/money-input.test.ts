import { describe, expect, it } from "vitest";
import { parseMoneyInput } from "./money-input";

describe("fail-closed money input", () => {
  it.each([
    ["4.500.000", 4_500_000],
    ["4.500,25 ₺", 4_500.25],
    ["4500.25", 4_500.25],
    ["TRY 1 250,50", 1_250.5],
    ["0.29", 0.29],
    [1250.5, 1_250.5],
  ])("parses %p", (input, expected) => {
    expect(parseMoneyInput(input)).toEqual({ ok: true, value: expected });
  });

  it.each(["-500", "+500", "1,2,3", "12abc", "1.23.4", "10,999", 0, NaN])(
    "rejects malformed or non-positive %p",
    (input) => expect(parseMoneyInput(input)).toEqual({ ok: false, value: null }),
  );

  it("distinguishes an optional blank from an invalid value", () => {
    expect(parseMoneyInput(" ")).toEqual({ ok: true, value: null });
    expect(parseMoneyInput("--")).toEqual({ ok: false, value: null });
    expect(parseMoneyInput("0", { allowZero: true })).toEqual({ ok: true, value: 0 });
  });
});
