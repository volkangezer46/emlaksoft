import { describe, expect, it } from "vitest";
import { parseEndeksaValuationResponse } from "./endeksa";
import { parseTapusorParcelInsightResponse } from "./tapusor";

describe("valuation provider response contracts", () => {
  it("accepts a complete finite Endeksa evidence set", () => {
    expect(parseEndeksaValuationResponse({
      valueMin: "4000000",
      valueMax: 6_000_000,
      valueAvg: 5_000_000,
      pricePerSqm: 50_000,
      priceChange12m: 12.5,
      sampleSize: 42,
      confidence: 0.82,
    })).toEqual({
      valueMin: 4_000_000,
      valueMax: 6_000_000,
      valueAvg: 5_000_000,
      pricePerSqm: 50_000,
      priceChange12m: 12.5,
      sampleSize: 42,
      confidence: 0.82,
    });
  });

  it.each([
    { valueMin: 1, valueMax: 2, valueAvg: Number.POSITIVE_INFINITY },
    { valueMin: 3, valueMax: 2, valueAvg: 2.5 },
    { valueMin: 1, valueMax: 3, valueAvg: 4 },
    { valueMin: 1, valueMax: 3, valueAvg: 2, confidence: 101 },
    { valueMin: 1, valueMax: 3, valueAvg: 2, sampleSize: -1 },
  ])("rejects impossible Endeksa evidence: %o", (response) => {
    expect(() => parseEndeksaValuationResponse(response)).toThrow(SyntaxError);
  });

  it("does not invent provider confidence when Endeksa omits it", () => {
    expect(parseEndeksaValuationResponse({
      valueMin: 4_000_000,
      valueMax: 6_000_000,
      valueAvg: 5_000_000,
    }).confidence).toBe(0);
  });

  it("normalizes Tapusor values and drops non-string legal flag payloads", () => {
    expect(parseTapusorParcelInsightResponse({
      investmentScore: "85",
      estimatedValue: 5_250_000,
      rentYieldMonths: 180,
      priceChange12m: -2.5,
      legalFlags: ["  İpotek kontrolü  ", { private: "must not stringify" }, ""],
    })).toEqual({
      investmentScore: 85,
      estimatedValue: 5_250_000,
      rentYieldMonths: 180,
      priceChange12m: -2.5,
      legalFlags: ["İpotek kontrolü"],
    });
  });

  it.each([
    { investmentScore: -1 },
    { investmentScore: 101 },
    { estimatedValue: Number.NaN },
    { estimatedValue: -10 },
    { rentYieldMonths: 0 },
    { priceChange12m: Number.POSITIVE_INFINITY },
    { legalFlags: "not-an-array" },
  ])("rejects impossible Tapusor evidence: %o", (response) => {
    expect(() => parseTapusorParcelInsightResponse(response)).toThrow(SyntaxError);
  });
});
