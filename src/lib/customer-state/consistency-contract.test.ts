import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { DAY_MS } from "@/lib/clock";
import { buildCustomerState, computeCustomerHeat, type CustomerStateInput } from "@/lib/customer-state/core";

/**
 * Tutarlılık sözleşmesi: aynı müşteri tüm yüzeylerde aynı sıcaklık/riski alır.
 *  1) Davranış: yüzeylerin kullandığı girdi yolları (tam durum, yalnız ısı havuzu) aynı sonucu verir.
 *  2) Statik: skor/risk modelleri `src/lib/customer-state` dışından ÇAĞRILMAZ (eski dağınık hesap geri gelmesin).
 */
const NOW = Date.UTC(2026, 9, 8, 12, 0, 0);
const ago = (d: number) => new Date(NOW - d * DAY_MS).toISOString();

const CASES: Partial<CustomerStateInput>[] = [
  { heatSignals: { last_contact: ago(1), open_demands: 2, urgent_demands: 1, portal_likes_30d: 1, open_offers: 1, open_deals: 0 } },
  { heatSignals: { last_contact: ago(20), open_demands: 0, urgent_demands: 0, portal_likes_30d: 0, open_offers: 0, open_deals: 1 } },
  { heatSignals: { last_contact: ago(130), open_demands: 1, urgent_demands: 0, portal_likes_30d: 0, open_offers: 0, open_deals: 0 } },
  { heatSignals: null, leadSignals: { active_demands: 1, comms: 2, appts: 0, calls: 1, last_activity: ago(4) } },
  { blacklist: true },
];

const baseInput = (o: Partial<CustomerStateInput>): CustomerStateInput => ({
  customerId: "c1",
  createdAt: ago(250),
  blacklist: false,
  hasPhone: true,
  hasEmail: false,
  source: "web_sitesi",
  types: ["Alıcı"],
  leadSignals: { active_demands: 1, comms: 3, appts: 1, calls: 2, last_activity: ago(10) },
  heatSignals: null,
  hasUpcomingAppointment: false,
  ...o,
});

describe("müşteri durumu: yüzeyler arası tutarlılık", () => {
  it.each(CASES.map((c, i) => [i, c] as const))("vaka %i: havuz ısısı = tam durum ısısı; sıcaklık ısıdan türer", (_i, c) => {
    const inp = baseInput(c);
    const full = buildCustomerState(inp, NOW, { dormantDays: 75 });
    const pool = computeCustomerHeat({ createdAt: inp.createdAt, blacklist: inp.blacklist }, inp.heatSignals, NOW, { dormantDays: 75 }, inp.leadSignals);
    expect(pool.segment).toBe(full.scores.heat.segment);
    expect(pool.score).toBe(full.scores.heat.score);
    const expected = full.scores.heat.segment === "sicak" ? "sicak" : full.scores.heat.segment === "ilgili" ? "ilik" : "soguk";
    expect(full.temperature).toBe(expected);
  });

  it("aynı girdi iki kez → aynı çıktı (saf)", () => {
    const inp = baseInput(CASES[0]!);
    expect(buildCustomerState(inp, NOW)).toEqual(buildCustomerState({ ...inp }, NOW));
  });

  it("aday skoru sıcaklığı belirlemez: yüksek aday skoru + soğuk ısı = soğuk", () => {
    const s = buildCustomerState(
      baseInput({
        leadSignals: { active_demands: 2, comms: 8, appts: 3, calls: 5, last_activity: ago(200) },
        heatSignals: { last_contact: ago(200), open_demands: 0, urgent_demands: 0, portal_likes_30d: 0, open_offers: 0, open_deals: 0 },
      }),
      NOW,
    );
    expect(s.temperature).toBe("soguk");
  });
});

const ROOT = join(process.cwd(), "src");
function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) files(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

describe("skor/risk modelleri yalnız customer-state içinden çağrılır", () => {
  // summary.ts: RPC ısısı yokken (yedek) temas verisinden ısı — okuyucudan ısı verilirse hesaplanmaz.
  const ALLOW = new Set(["src/lib/customer-intelligence/summary.ts"]);
  const CALLS = /\b(computeLeadScore|computeChurnRisk|scoreCustomerHeat|scoreSellerLikelihood)\s*\(/;

  it("ekranlar ve içgörü kuralları modelleri doğrudan çağırmaz", () => {
    const offenders: string[] = [];
    for (const f of files(ROOT)) {
      const rel = relative(process.cwd(), f).replace(/\\/g, "/");
      if (rel.startsWith("src/lib/customer-state/") || ALLOW.has(rel)) continue;
      if (CALLS.test(readFileSync(f, "utf8"))) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it("eski dağınık dosyalar geri gelmez", () => {
    const libs = readdirSync(join(ROOT, "lib"));
    for (const gone of ["lead-score.ts", "customer-heat.ts", "churn-risk.ts", "seller-prediction.ts", "deal-score.ts"]) {
      expect(libs).not.toContain(gone);
    }
  });

  it("eşik sabitleri tek yerde: modeller kesim sayılarını thresholds.ts'ten alır", () => {
    for (const f of ["heat", "lead", "churn", "seller", "deal"]) {
      expect(readFileSync(join(ROOT, "lib/customer-state", `${f}.ts`), "utf8")).toContain('@/lib/customer-state/thresholds');
    }
  });
});
