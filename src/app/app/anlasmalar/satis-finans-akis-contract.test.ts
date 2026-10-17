import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * Satış & finans akışı sözleşmesi (saha denetimi 2026-10-16):
 *  - Tutar alanları `type="number" step="1000"` değil `MoneyInput` (yuvarlak teklif tutarı "Geçerli bir değer girin" ile reddediliyordu).
 *  - Liste sayfalarında eski `?yeni=1` / popup ön dolgu takma adları yok (sahip kuralı: yönlendirme / takma ad yok).
 *  - İmza paneli boş şablon alanında açık onay ister, sözleşmenin müşterisini ilk imzalayan önerir.
 *  - Anlaşma detayında aşama geçişi ve teklif/sözleşme sonraki adımları var.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));
vi.mock("@/app/actions/contracts", () => ({ sendContractForSigning: async () => ({ ok: true }) }));
vi.mock("@/components/ui/phone-input", () => ({ PhoneInput: (p: { value?: string }) => createElement("input", { "data-phone": p.value ?? "" }) }));
vi.mock("@/components/ui/email-input", () => ({ EmailInput: (p: { value?: string }) => createElement("input", { "data-email": p.value ?? "" }) }));

import { ContractSignPanel } from "../sozlesmeler/[id]/contract-sign-panel";
import { buildOfferEvents } from "../teklifler/[id]/offer-events";
import { groupComparableProperties } from "../teklifler/karsilastir/compare-pick";
import { dealContractFillReport } from "../sozlesmeler/yeni/deal-context";
import { countContractPlaceholders } from "@/lib/contract-risk";

const ROOT = join(process.cwd(), "src/app/app");
const AREA = ["anlasmalar", "teklifler", "sozlesmeler", "kiralama", "aidat"];
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx") && !p.endsWith(".test.tsx")) out.push(p);
  }
  return out;
}

describe("tutar alanları", () => {
  it("satış alanında step=1000 / step=0.01 sayı kutusuyla tutar girilmez", () => {
    const bad: string[] = [];
    for (const area of AREA) {
      for (const file of walk(join(ROOT, area))) {
        const src = readFileSync(file, "utf8");
        // name="amount|deal_value|monthly_rent|deposit|deposit_amount" taşıyan type=number alanı
        const re = /<(?:input|FormInput)[^>]*name="(amount|deal_value|monthly_rent|deposit|deposit_amount)"[^>]*type="number"|<(?:input|FormInput)[^>]*type="number"[^>]*name="(amount|deal_value|monthly_rent|deposit|deposit_amount)"/g;
        if (re.test(src) || /step="1000"/.test(src)) bad.push(file.replace(ROOT, ""));
      }
    }
    expect(bad).toEqual([]);
  });

  it("teklif, karşı teklif, tur, anlaşma ve kapanış tutarı MoneyInput kullanır", () => {
    for (const f of [
      "teklifler/yeni/new-offer-form.tsx",
      "teklifler/[id]/offer-status-actions.tsx",
      "teklifler/[id]/offer-round-dialog.tsx",
      "teklifler/[id]/offer-edit-dialog.tsx",
      "anlasmalar/yeni/satis-sihirbazi.tsx",
      "anlasmalar/[id]/kapanis-sihirbazi.tsx",
      "kiralama/yeni/kira-sihirbazi.tsx",
    ]) {
      expect(read(f), f).toContain("<MoneyInput");
    }
    // Karşı teklif sayısı Number("4.800.000") = NaN olmasın: TR ayrıştırıcıyla çözülür.
    expect(read("teklifler/[id]/offer-status-actions.tsx")).toContain("moneyTextToNumber(counter)");
  });
});

describe("takma ad yok", () => {
  it("liste sayfaları eski ?yeni=1 / popup ön dolgu adreslerini yönlendirmez", () => {
    for (const f of ["anlasmalar/page.tsx", "teklifler/page.tsx", "sozlesmeler/page.tsx"]) {
      const src = read(f);
      expect(src, f).not.toMatch(/yeni === "1"/);
      expect(src, f).not.toMatch(/\bredirect\(/);
    }
  });

  it("yetkisiz 'yeni' sayfaları listeye sessizce değil, yetki kartına gider", () => {
    for (const f of ["teklifler/yeni/page.tsx", "sozlesmeler/yeni/page.tsx", "kiralama/yeni/page.tsx", "anlasmalar/yeni/page.tsx"]) {
      expect(read(f), f).toContain("deniedPageHref(");
    }
  });
});

describe("anlaşma detayı sonraki adımlar", () => {
  const page = read("anlasmalar/[id]/page.tsx");
  it("aşama geçişi detaydan yapılabilir", () => {
    expect(page).toContain("<StatusTransitionBar");
  });
  it("belgeler sekmesi Türkçe durum etiketi ve teklif/sözleşme düğmesi taşır", () => {
    expect(page).toContain("OFFER_STATUS_LABELS[o.status]");
    expect(page).toContain("CONTRACT_STATUS_LABELS[c.status]");
    expect(page).toContain("<DealContractCta");
    expect(page).toContain("deal_id.eq.${deal.id}");
  });
});

describe("imza paneli", () => {
  it("boş alan varken gönderim onaysız kilitli ve uyarı gösterir", () => {
    const html = renderToStaticMarkup(createElement(ContractSignPanel, { contractId: "c1", status: "draft", blankCount: 3 }));
    expect(html).toContain("3 doldurulmamış alan");
    expect(html).toContain("Boş alanlarla göndermeyi onaylıyorum");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*İmzaya gönder/);
  });
  it("sözleşmenin müşterisi ilk imzalayan olarak önerilir", () => {
    const html = renderToStaticMarkup(
      createElement(ContractSignPanel, { contractId: "c1", status: "draft", defaultSigner: { full_name: "Ayşe Demir", phone: "05321112233" } }),
    );
    expect(html).toContain('value="Ayşe Demir"');
    expect(html).toContain('data-phone="05321112233"');
    expect(html).not.toContain("doldurulmamış alan");
  });
  it("yer tutucu sayımı tek kuraldan", () => {
    expect(countContractPlaceholders("Satıcı: ____ Adres: ___ Not: __")).toBe(2);
    expect(countContractPlaceholders(null)).toBe(0);
  });
});

describe("saf yardımcılar", () => {
  it("aynı anda oluşturulup sunulan teklif zaman çizelgesinde tek olay", () => {
    const base = {
      offer: { created_at: "2026-10-16T19:16:00Z", submitted_at: "2026-10-16T19:16:01Z", responded_at: null, status: "submitted", valid_until: null },
      rounds: [],
      statusLabel: "Sunuldu",
      money: (n: number | null) => String(n),
      todayKey: "2026-10-16",
      deal: null,
    } as unknown as Parameters<typeof buildOfferEvents>[0];
    const titles = buildOfferEvents(base).map((e) => e.title);
    expect(titles).toContain("Teklif oluşturuldu ve sunuldu");
    expect(titles).not.toContain("Teklif sunuldu");
    const later = buildOfferEvents({ ...base, offer: { ...base.offer, submitted_at: "2026-10-17T10:00:00Z" } }).map((e) => e.title);
    expect(later).toEqual(expect.arrayContaining(["Teklif oluşturuldu", "Teklif sunuldu"]));
  });

  it("karşılaştırma seçici yalnız 2+ teklifli portföyleri, çoktan aza sıralar", () => {
    const p = (id: string) => ({ id, title: `P${id}`, property_code: `K${id}`, list_price: 1000 });
    const out = groupComparableProperties([
      { propertyId: "a", amount: 10, property: p("a") },
      { propertyId: "b", amount: 30, property: p("b") },
      { propertyId: "b", amount: 50, property: p("b") },
      { propertyId: "c", amount: 5, property: p("c") },
      { propertyId: "c", amount: 7, property: p("c") },
      { propertyId: "c", amount: 6, property: p("c") },
    ]);
    expect(out.map((c) => [c.propertyId, c.count, c.maxAmount])).toEqual([
      ["c", 3, 7],
      ["b", 2, 50],
    ]);
  });

  it("sözleşme ön dolgu raporu boş kalanı adıyla söyler", () => {
    const r = dealContractFillReport(
      {
        dealType: "sale",
        buyerName: "Ahmet",
        sellerName: null,
        propertyTitle: "Daire",
        propertyCode: "K1",
        propertyAddress: null,
        price: 4_250_000,
        depositAmount: null,
        paymentMethodLabel: null,
        deedDate: null,
        officeName: "Ofis",
        validUntil: null,
        creditContingency: false,
      },
      "kapora",
    );
    expect(r.filled).toEqual(["tutar", "alıcı"]);
    expect(r.missing).toEqual(["satıcı/malik", "portföy adresi", "kapora", "ödeme şekli"]);
  });
});
