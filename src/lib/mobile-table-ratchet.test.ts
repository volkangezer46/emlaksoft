import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { countWidePatterns, scanWidePatterns } from "./mobile-table-ratchet";

/**
 * MP12 statik mobil düzen ratchet'i: telefonda yana kaydırma doğuran geniş sabit genişlik / kaydırmalı tablo
 * (mobil kart karşılığı olmadan) YENİ dosyada çıkamaz, mevcut dosyada ARTAMAZ. Taban yalnız küçülür: dosya
 * temizlenince satırı silinmelidir (bayat satır testi düşürür). Piksel karşılığı: e2e/mobile-sweep.spec.ts.
 *
 * Anahtar dosya yolunun SONEKİDİR (rota taşımalarında — ör. giderler → finans — taban aynı dosyayı bulur).
 * Gerekçeli kalıcı istisnalar `reason` taşır; gerisi borçtur (mobil kart eklenince satır silinir).
 */
const BASELINE: Record<string, { count: number; reason?: string }> = {
  // Kalıcı: masaüstü yönetim / düzenleyici ızgaraları, kaydırma kapsayıcı içinde (sayfa taşmaz).
  "admin/site/rehber/[id]/block-list.tsx": { count: 2, reason: "tablo bloğu düzenleyicisi (hücre girişleri), kapsayıcı içinde kayar" },
  "admin/tickets/ayarlar/desk-settings-forms.tsx": { count: 2, reason: "SLA matrisi düzenleyicisi; ilk sütun sabit, kapsayıcı içinde kayar" },
  "app/projeler/[id]/import-units.tsx": { count: 1, reason: "yapıştırma önizlemesi, max-h kapsayıcı içinde kayar" },
  "admin/tenants/[id]/subscription-panel.tsx": { count: 1, reason: "4 kısa sütun, sabit genişlik yok; 360 px'e sığar" },
  "components/marketing/emlakfiyati-section.tsx": { count: 4, reason: "pazarlama karşılaştırması, kapsayıcı içinde kayar" },
  "components/pricing-page/comparison-table.tsx": { count: 1, reason: "fiyat karşılaştırma tablosu, ilk sütun sabit" },
  "app/kiralama/basvurular/karsilastir/page.tsx": { count: 2, reason: "aday karşılaştırma matrisi (sütun = aday), kapsayıcı içinde yatay kayar" },
  "components/auth/auth-shell.tsx": { count: 1, reason: "yalnız lg+ görünen yan panel genişliği" },
  // Borç (mobil kart bekliyor). Finans sekmeleri C0 taşımasından sonra ele alınacak.
  "admin/_dashboards/platform-sections.tsx": { count: 1 },
  "admin/_dashboards/revenue-retention-sections.tsx": { count: 1 },
  "admin/aktivite/page.tsx": { count: 1 },
  "admin/ayarlar/tufe/tufe-form.tsx": { count: 1 },
  "admin/billing/faturalar/[id]/page.tsx": { count: 1 },
  "admin/billing/muhasebe/page.tsx": { count: 1 },
  "admin/sistem/system-view.tsx": { count: 1 },
  "admin/tenants/[id]/page.tsx": { count: 1 },
  "admin/tickets/ticket-queue-view.tsx": { count: 1 },
  "app/ayarlar/yetkilendirme/override-manager.tsx": { count: 1 },
  "app/ayarlar/yetkilendirme/scope-table.tsx": { count: 1 },
  "app/ayarlar/yetkilendirme/user-exceptions.tsx": { count: 1 },
  "app/degerleme/page.tsx": { count: 1 },
  "/_tabs/vergi.tsx": { count: 2 },
  "/statement-upload.tsx": { count: 2 },
  "app/hesaplayici/calculator.tsx": { count: 2 },
  "app/hesaplayici/investment-analyzer.tsx": { count: 2 },
  "app/raporlar/lead-hizi/page.tsx": { count: 1 },
  "app/raporlar/talep-arz/page.tsx": { count: 1 },
  "components/tools/calculators.tsx": { count: 1 },
};

const findings = scanWidePatterns(process.cwd());
const keyOf = (file: string) => Object.keys(BASELINE).find((k) => file.endsWith(k));

describe("mobil tablo ratchet'i (MP12, statik)", () => {
  it("sayaç: mobil kart işareti olan dosya temiz, olmayan geniş deseni sayar", () => {
    expect(countWidePatterns('<div className="overflow-x-auto"><table className="w-full min-w-[640px]">')).toBe(2);
    expect(countWidePatterns('<ul className="md:hidden" /><div className="hidden md:block overflow-x-auto"><table className="min-w-[640px]">')).toBe(0);
    expect(countWidePatterns('<table className="adm-tbl-m w-full md:min-w-[720px]">')).toBe(0);
    expect(countWidePatterns('<div className="md:min-w-[720px] lg:w-[480px]" />')).toBe(0);
    expect(countWidePatterns('<div className="min-w-[22rem]" />')).toBe(0);
    expect(countWidePatterns('<div className="min-w-[26rem]" />')).toBe(1);
  });

  it("yeni dosyada mobil karşılıksız geniş tablo / sabit genişlik yok; mevcutta artış yok", () => {
    const over = findings
      .map((f) => ({ ...f, key: keyOf(f.file) }))
      .filter((f) => !f.key || f.count > BASELINE[f.key]!.count)
      .map((f) => `${f.file}: ${f.count}${f.key ? ` > taban ${BASELINE[f.key]!.count}` : " (tabanda yok)"}`);
    expect(over, "md:hidden kart listesi (list-kit MobileCardList), DataTable mobileCards ya da adm-tbl-m + data-label ekleyin").toEqual([]);
  });

  it("taban yalnız küçülür: temizlenen dosyanın satırı silinmiş, azalan sayaç güncellenmiş", () => {
    const stale = Object.entries(BASELINE)
      .map(([k, v]) => {
        const hit = findings.find((f) => f.file.endsWith(k));
        if (!hit) return `${k}: temizlendi, tabandan silin`;
        return hit.count < v.count ? `${k}: ${hit.count} < taban ${v.count}, tabanı düşürün` : null;
      })
      .filter(Boolean);
    expect(stale).toEqual([]);
  });

  it("MP11: ekip performansı, uyum raporu, bölge analizi ve malik portalı telefonda kart çizer", () => {
    for (const f of [
      "src/app/app/_home/ekip-performans.tsx",
      "src/app/app/_home/danisman-ara.tsx",
      "src/app/app/raporlar/yetki-uyum/page.tsx",
      "src/app/app/ilan-kontrol/eklenti/page.tsx",
      "src/components/listing-control/property-lifecycle-panel.tsx",
      "src/app/malik-portali/[token]/owner-payout-section.tsx",
      "src/app/malik-portali/[token]/rent-statement-view.tsx",
    ]) {
      expect(findings.find((x) => x.file === f), f).toBeUndefined();
    }
    expect(readFileSync("src/app/app/bolge-analizi/page.tsx", "utf8")).toMatch(/<DataTable[\s\S]*?\bmobileCards\b/);
  });
});
