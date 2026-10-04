import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { describeDeleteImpact } from "./delete-impact";
import {
  applyCustomerFilters,
  customerSearchTerm,
  hasCustomerFilters,
  normalizeCustomerFilters,
} from "@/lib/customer-list-filters";

const root = path.resolve(import.meta.dirname, "../../../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

describe("müşteri silme etki özeti", () => {
  const base = { openDeals: 0, openDemands: 0, openTasks: 0, activeAppointments: 0, contracts: 0 };

  it("bağlı kayıt yoksa boş döner", () => {
    expect(describeDeleteImpact(null)).toEqual([]);
    expect(describeDeleteImpact(base)).toEqual([]);
  });

  it("yalnız sıfırdan büyük kalemleri sayılarıyla yazar", () => {
    expect(describeDeleteImpact({ ...base, openDeals: 2, openTasks: 1, contracts: 3 })).toEqual([
      "2 açık anlaşma",
      "1 açık görev",
      "3 sözleşme",
    ]);
  });
});

describe("müşteri listesi filtre kurucusu (ekran + CSV ortak)", () => {
  it("bozuk tarih ve bilinmeyen segmenti eler", () => {
    const f = normalizeCustomerFilters({ from: "2026-13-xx", to: "2026-05-01", segment: "yanlis" });
    expect(f.from).toBe("");
    expect(f.to).toBe("2026-05-01");
    expect(f.segment).toBe("");
  });

  it("segment geçerliyse korunur ve filtre sayılır", () => {
    const f = normalizeCustomerFilters({ segment: "sicak" });
    expect(f.segment).toBe("sicak");
    expect(hasCustomerFilters(f)).toBe(true);
    expect(hasCustomerFilters(normalizeCustomerFilters({}))).toBe(false);
  });

  it("arama terimi .or() sözdizimini bozan karakterleri ayıklar", () => {
    expect(customerSearchTerm(" a,b(c)%_ ")).toBe("a b c");
  });

  it("filtreleri sorguya uygular (tür, etiket, kaynak, danışman, tarih, arama)", () => {
    const calls: string[] = [];
    const chain: Record<string, (...a: unknown[]) => unknown> = {};
    for (const m of ["contains", "eq", "gte", "lte", "or"]) {
      chain[m] = (...a: unknown[]) => {
        calls.push(`${m}:${a.join("|")}`);
        return chain;
      };
    }
    applyCustomerFilters(
      chain,
      normalizeCustomerFilters({ type: "Alıcı", etiket: "VIP", source: "web", assigned: "u1", from: "2026-01-01", to: "2026-02-01", q: "Ali" }),
    );
    expect(calls).toContain("contains:customer_types|Alıcı");
    expect(calls).toContain("contains:tags|VIP");
    expect(calls).toContain("eq:source|web");
    expect(calls).toContain("eq:assigned_to|u1");
    expect(calls).toContain("gte:created_at|2026-01-01");
    expect(calls.some((c) => c.startsWith("or:full_name.ilike.%Ali%"))).toBe(true);
  });
});

describe("K3 kaynak sözleşmeleri", () => {
  it("müşteri detay sayfası yalnız tanımlı sekme kimliklerine bakar (P0-1: dosyalar/belgeler)", () => {
    const src = read("src/app/app/musteriler/[id]/page.tsx");
    const used = [...src.matchAll(/tab === "([a-z]+)"/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(0);
    // Sekme kimlikleri istemci modülünde tanımlı (sunucu bağımlılığı çekmemek için kaynaktan okunur)
    const tabsSrc = read("src/app/app/musteriler/[id]/customer-360-tabs.tsx");
    const ids = [...tabsSrc.slice(tabsSrc.indexOf("CUSTOMER_TAB_IDS = ["), tabsSrc.indexOf("] as const")).matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
    for (const id of used) expect(ids).toContain(id);
  });

  it("kampanya düzenleme yalnız taslakta yazar", () => {
    const src = read("src/app/actions/campaigns.ts");
    const body = src.slice(src.indexOf("export async function updateCampaign"));
    expect(body).toContain('.eq("status", "draft")');
    expect(body).toContain("Yalnız taslak kampanya düzenlenebilir.");
  });

  it("'E-posta (yakında)' kampanya seçeneği yok", () => {
    expect(read("src/app/app/kampanyalar/yeni/new-campaign-form.tsx")).not.toContain("yakında");
  });

  it("toplu müşteri silme kayıt kimlikli denetim satırı yazar (çöp kutusu 'Silen')", () => {
    const src = read("src/app/actions/customers.ts");
    const body = src.slice(src.indexOf("export async function bulkDeleteCustomers"));
    expect(body).toContain('action: "customer.delete"');
    expect(body).toContain("entityId: cid");
  });
});
