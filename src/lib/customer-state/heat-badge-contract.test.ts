import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DAY_MS } from "@/lib/clock";
import { buildCustomerState, TEMPERATURE_LABELS, type CustomerStateInput } from "@/lib/customer-state/core";
import { HEAT_SEGMENTS, heatBadge } from "@/lib/customer-state/heat";
import { buildCustomerIntel } from "@/lib/customer-intelligence/summary";

/**
 * YD5: müşteri sıcaklığı kartta (Müşteri 360 başlığı), Müşteri sıcaklığı kartında ve listede AYNI etiket ve AYNI sayı.
 * Canlıda aynı müşteri başlıkta "Ilık · 82" (sıcaklık kelimesi + aday skoru), kartta "İlgili · 55/100" ve listede
 * "Soğuk" + ayrı "40" gösteriyordu.
 */
const NOW = Date.UTC(2026, 9, 14, 12, 0, 0);
const ago = (d: number) => new Date(NOW - d * DAY_MS).toISOString();
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const input = (o: Partial<CustomerStateInput>): CustomerStateInput => ({
  customerId: "c1",
  createdAt: ago(250),
  blacklist: false,
  hasPhone: true,
  hasEmail: true,
  source: "web_sitesi",
  types: ["Alıcı"],
  // Yüksek aday skoru (çok temas/randevu) — eskiden başlıkta sıcaklık kelimesinin yanına bu sayı yazılıyordu.
  leadSignals: { active_demands: 2, comms: 8, appts: 3, calls: 5, last_activity: ago(10) },
  heatSignals: { last_contact: ago(10), open_demands: 1, urgent_demands: 0, portal_likes_30d: 0, open_offers: 0, open_deals: 0 },
  hasUpcomingAppointment: false,
  ...o,
});

describe("müşteri sıcaklığı: tek etiket, tek sayı", () => {
  it("kart başlığı, Müşteri sıcaklığı kartı ve liste satırı aynı metni üretir; aday skoru başlık sayısı değildir", () => {
    const state = buildCustomerState(input({}), NOW);
    const header = heatBadge(state.scores.heat).text; // musteriler/[id]/page.tsx
    const intel = buildCustomerIntel(
      { customerId: "c1", createdAt: ago(250), blacklist: false, touches: [], openDemands: 1, hasOpenOfferOrDeal: false, heat: state.scores.heat, heatSignals: null },
      NOW,
    );
    const card = heatBadge(intel.heat).text; // customer-intel-card.tsx
    const row = heatBadge(state.scores.heat).text; // musteriler/data.ts → customer-rows.tsx
    expect(header).toBe(card);
    expect(row).toBe(card);
    expect(header).toBe(`${HEAT_SEGMENTS[state.scores.heat.segment].label} · ${state.scores.heat.score}`);
    expect(state.scores.lead.score).not.toBe(state.scores.heat.score);
    expect(header).not.toContain(String(state.scores.lead.score));
  });

  it("tek kelime seti: 'Ilık' yok; kaba sıcaklık etiketleri segment kelimeleriyle aynı", () => {
    expect(Object.values(TEMPERATURE_LABELS)).toEqual(["Sıcak", "İlgili", "Soğuk"]);
    expect(Object.values(HEAT_SEGMENTS).map((s) => s.label)).toEqual(["Sıcak", "İlgili", "Soğuk", "Uykuda"]);
    const lead = buildCustomerState(input({}), NOW).scores.lead;
    expect(["Yüksek", "Orta", "Düşük"]).toContain(lead.label);
  });

  it("yüzeyler rozet metnini heatBadge'den alır (kopya biçim yok)", () => {
    const page = read("src/app/app/musteriler/[id]/page.tsx");
    expect(page).toMatch(/heatBadge\(state\.scores\.heat\)\.text/);
    expect(page).not.toMatch(/TEMPERATURE_LABELS\[state\.temperature\]\} · \{lead\.score\}/);

    const card = read("src/app/app/musteriler/[id]/customer-intel-card.tsx");
    expect(card).toMatch(/heatBadge\(intel\.heat\)/);
    expect(card).not.toMatch(/\/100<|score\}\/100/);
    // Tek dil: kartın kullanıcı metninde "ısı" geçmez (başlık "Müşteri sıcaklığı"); yorumlar hariç.
    const cardCode = card.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(cardCode).not.toMatch(/(^|[^\p{L}])ısı([^\p{L}]|$)/u);

    const data = read("src/app/app/musteriler/data.ts");
    expect(data).toMatch(/label: heatBadge\(heat\)\.text/);

    const rows = read("src/app/app/musteriler/customer-rows.tsx");
    expect(rows).not.toMatch(/c\.lead/);
  });
});
