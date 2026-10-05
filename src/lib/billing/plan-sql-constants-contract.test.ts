import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BUSINESS_PLAN_TEMPLATE, DEFAULT_YEARLY_PAID_MONTHS, PLANS, type PlanDef } from "./plans";

/**
 * SQL <-> TS PLAN SABİT SÖZLEŞMESİ (PANEL_KARAR_1, P1).
 *
 * Veritabanı fonksiyonları plan fiyatını/limitini sabit olarak yazar (`when 'office' then 2490`,
 * `* 12 * 0.8`, plan_entitlements seed). Bu sabitler TS plan tanımından (plans.ts) sapınca
 * müşteriye yanlış tutar kesilir. Test, `supabase/migrations` içindeki bu sabitleri metin
 * taramasıyla bulup plan tanımıyla karşılaştırır.
 *
 * BİLİNEN AÇIK listesi (KNOWN_OPEN): uygulanmış migration dosyaları değiştirilemez (forward-only),
 * düzeltme P2 migration'ıdır (supabase/proposed/ altında yazılıyor, henüz uygulanmadı). Her bilinen
 * açık dosya/işlev gerekçeli ve TODO(P2) etiketlidir.
 *  - Listede OLMAYAN yeni bir uyumsuzluk/sabit çıkarsa test KIRILIR (yeni sapma sessizce eklenemez).
 *  - Listede olup artık sapma içermeyen kayıt da test'i KIRAR (bayat kayıt silinmelidir).
 *
 * P2 TERFİ ETTİ (2026-10-05): `20260825000300_billing_plan_amount_integrity.sql` (eski taslak
 * proposed/20261005000500) fonksiyonları açık gövdeli yeniden tanımlar; eski dosyalar (değiştirilemez) eski
 * sabitleri taşımaya devam eder ve SUPERSEDED_BY'a taşındı. Yeni dosya da taranır; doğru sabitleri taşır.
 * KNOWN_OPEN'da kalanlar P2'nin KAPSAMADIĞI gerçek açıklardır (9 argümanlı eski fulfill overload'u ve
 * plan_entitlements seed'i); ayrı düzeltici migration ile boşalır (hedef durum: boş liste).
 * NOT: canlıda P2 henüz UYGULANMADI; bu test dosya düzeyindedir (migrations/ içeriği), canlı DB'yi değil.
 */

const MIGRATIONS_DIR = resolve(process.cwd(), "supabase/migrations");

type Kind = "price" | "yearly" | "business-missing" | "entitlement";
type Finding = `${string}::${Kind}`;

type OpenItem = { file: string; kind: Kind; fn: string; why: string };

/** Fiyat sabiti olan ama TEK SEFERLİK tarihsel seed olan dosya: işlev değildir, yeniden çalışmaz. */
const HISTORICAL_SEED_FILES = new Set(["20260722000006_billing_tickets.sql"]);

/**
 * Eski dosya -> onu geçersiz kılan (aynı işlevleri yeniden tanımlayan) daha yeni dosya.
 * Yeni dosya migrations içinde VARSA eski dosya taranmaz.
 * Not: dosya bazlıdır; dosyadaki SABİT TAŞIYAN işlevlerin tamamı yeniden tanımlanmışsa eklenir
 * (20260802000300'de sabit taşıyan tek işlev update_tenant_plan_subscription'dır; diğer işlevleri sabit içermez).
 */
const SUPERSEDED_BY: Readonly<Record<string, string>> = {
  "20260809000000_billing_fulfillment_hardening.sql": "20260825000300_billing_plan_amount_integrity.sql", // fulfill_billing_payment (10 arg)
  "20260731000140_atomic_registration_provisioning.sql": "20260825000300_billing_plan_amount_integrity.sql", // provision_registration
  "20260802000300_identity_session_authorization_hardening.sql": "20260825000300_billing_plan_amount_integrity.sql", // update_tenant_plan_subscription
  "20260802000400_atomic_demo_conversion.sql": "20260825000300_billing_plan_amount_integrity.sql", // convert_demo_request_to_tenant
};

const KNOWN_OPEN: readonly OpenItem[] = [
  {
    file: "20260731000138_atomic_billing_fulfillment.sql",
    kind: "price",
    fn: "fulfill_billing_payment (9 argümanlı ESKİ overload; 10 argümanlı tanım ayrı imzadır)",
    why: "TODO(P2): 990/5990 sabitleri; 20260825000300 yalnız 10 argümanlı imzayı yeniden tanımlar, 9 argümanlı overload canlıda kalır (kod çağırmıyor). Ayrı temizlik migration'ı (drop function, 9 arg) gerekir.",
  },
  {
    file: "20260731000138_atomic_billing_fulfillment.sql",
    kind: "yearly",
    fn: "fulfill_billing_payment (9 argümanlı ESKİ overload)",
    why: "TODO(P2): yıllık tutar `* 12 * 0.8` (%20); onaylı kural '10 öde 12'. 9 argümanlı overload temizlik migration'ı bekliyor.",
  },
  {
    file: "20260731000138_atomic_billing_fulfillment.sql",
    kind: "business-missing",
    fn: "fulfill_billing_payment (9 argümanlı ESKİ overload)",
    why: "TODO(P2): 'business' için tutar yok (9 argümanlı overload); temizlik migration'ı bekliyor.",
  },
  {
    file: "20260802000320_plan_entitlements.sql",
    kind: "entitlement",
    fn: "plan_entitlements seed (professional)",
    why: "TODO(P2): professional kullanıcı limiti 20; onaylı katalog 15. P2 migration'ı ya da panel kaydı (plan_entitlements senkronu) düzeltir.",
  },
];

const catalog: readonly PlanDef[] = [...PLANS, BUSINESS_PLAN_TEMPLATE];
const priceByPlan = new Map(catalog.map((p) => [p.id as string, p.monthlyTry]));
const limitsByPlan = new Map(catalog.map((p) => [p.id as string, p.limits]));

const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
const read = (f: string) => readFileSync(resolve(MIGRATIONS_DIR, f), "utf8");

const PRICE_RE = /when\s+'(advisor|office|professional|business|enterprise)'\s+then\s+(\d[\d_]*(?:\.\d+)?)/gi;
const YEARLY_RE = /\*\s*12\s*\*\s*0\.8/;
const ENTITLEMENT_ROW_RE =
  /\(\s*'(advisor|office|professional|business|enterprise)'\s*,\s*(\d+|null)\s*,\s*(\d+|null)\s*,\s*(\d+|null)\s*,\s*(\d+|null)\s*\)/gi;

function scan(): Set<Finding> {
  const found = new Set<Finding>();
  for (const file of files) {
    if (HISTORICAL_SEED_FILES.has(file)) continue;
    const later = SUPERSEDED_BY[file];
    if (later && files.includes(later)) continue;
    const sql = read(file);

    const pricedPlans = new Set<string>();
    for (const m of sql.matchAll(PRICE_RE)) {
      const plan = m[1]!.toLowerCase();
      pricedPlans.add(plan);
      if (Number(m[2]!.replace(/_/g, "")) !== priceByPlan.get(plan)) found.add(`${file}::price`);
    }
    // Fiyat tablosu olan (en az bir plan fiyatı yazan) işlev Business'ı da kapsamalıdır.
    if (pricedPlans.size > 0 && !pricedPlans.has("business")) found.add(`${file}::business-missing`);

    if (YEARLY_RE.test(sql)) found.add(`${file}::yearly`);

    if (/insert\s+into\s+public\.plan_entitlements/i.test(sql)) {
      for (const m of sql.matchAll(ENTITLEMENT_ROW_RE)) {
        const plan = m[1]!.toLowerCase();
        const limits = limitsByPlan.get(plan)!;
        const val = (s: string) => (s.toLowerCase() === "null" ? null : Number(s));
        const sqlRow = [val(m[2]!), val(m[3]!), val(m[4]!), val(m[5]!)];
        const tsRow = [limits.seats, limits.customers, limits.activeProperties, limits.branches];
        if (JSON.stringify(sqlRow) !== JSON.stringify(tsRow)) found.add(`${file}::entitlement`);
      }
    }
  }
  return found;
}

describe("SQL <-> TS plan sabit sözleşmesi", () => {
  const found = scan();
  const known = new Set<Finding>(KNOWN_OPEN.map((k) => `${k.file}::${k.kind}` as Finding));

  it("tarama gerçekten fiyat sabiti buluyor (boş tarama sahte yeşil olmasın)", () => {
    const priced = files.filter((f) => !HISTORICAL_SEED_FILES.has(f) && new RegExp(PRICE_RE.source, "i").test(read(f)));
    expect(priced.length).toBeGreaterThanOrEqual(5);
    expect(files).toContain("20260809000000_billing_fulfillment_hardening.sql");
    expect(DEFAULT_YEARLY_PAID_MONTHS).toBe(10);
  });

  it("YENİ bir sabit/uyumsuzluk çıkarsa kırılır: bilinen-açık listesinde olmayan sapma yok", () => {
    const unexpected = [...found].filter((f) => !known.has(f));
    expect(unexpected, "Listede olmayan SQL plan sabiti sapması; düzeltin ya da gerekçeli KNOWN_OPEN'a ekleyin").toEqual([]);
  });

  it("bayat kayıt yok: bilinen-açık her kayıt hâlâ gerçek bir sapma (P2 terfisinden sonra liste boşalır)", () => {
    const stale = [...known].filter((k) => !found.has(k));
    expect(stale, "Sapması kalmayan kayıtları KNOWN_OPEN'dan silin").toEqual([]);
  });

  it("bilinen-açık her kayıt gerekçeli ve TODO(P2) etiketli", () => {
    for (const k of KNOWN_OPEN) {
      expect(k.why).toContain("TODO(P2)");
      expect(k.why.length).toBeGreaterThan(30);
      expect(k.fn.length).toBeGreaterThan(3);
    }
    expect(new Set(KNOWN_OPEN.map((k) => `${k.file}::${k.kind}`)).size).toBe(KNOWN_OPEN.length);
  });

  it("onaylı katalog fiyatları plan tanımında: 749 / 2.490 / 4.990 / 8.990 (Business) ve Kurumsal özel", () => {
    expect([...priceByPlan.entries()].filter(([id]) => id !== "enterprise")).toEqual([
      ["advisor", 749],
      ["office", 2490],
      ["professional", 4990],
      ["business", 8990],
    ]);
    expect(PLANS.find((p) => p.id === "enterprise")!.customPricing).toBe(true);
  });
});
