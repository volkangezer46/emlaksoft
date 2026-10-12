import { describe, expect, it } from "vitest";
import { efPackSchema } from "@/lib/ef-credits/config";
import { EF_DEFAULT_PACKS, isEfPackValid } from "@/lib/ef-credits/pack-core";

const base = { id: "ef-1000-1a", name: "Paket", units: 1000, months: 1, priceNetTry: 1000, active: true, order: 10 };

describe("isEfPackValid (istemci) şema ile aynı karar", () => {
  const cases: unknown[] = [
    ...EF_DEFAULT_PACKS,
    base,
    { ...base, id: "A" },
    { ...base, id: "x" },
    { ...base, name: " a " },
    { ...base, name: "x".repeat(61) },
    { ...base, units: 0 },
    { ...base, units: 100001 },
    { ...base, units: 1.5 },
    { ...base, months: 2 },
    { ...base, priceNetTry: 0.5 },
    { ...base, priceNetTry: 10_000_001 },
    { ...base, active: "evet" },
    { ...base, popular: true },
    { ...base, popular: "x" },
    { ...base, order: -1 },
    { ...base, order: 1001 },
    null,
    "x",
  ];
  it.each(cases.map((c, i) => [i, c] as const))("durum %i", (_i, c) => {
    expect(isEfPackValid(c)).toBe(efPackSchema.safeParse(c).success);
  });
});
