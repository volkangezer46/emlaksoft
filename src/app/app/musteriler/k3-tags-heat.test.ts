import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// Ofis tanımlı uykuda eşiği ayar okumasından gelir; birim testte ayar deposu yok (varsayılan eşik kullanılır).
vi.mock("@/lib/settings/read", () => ({ getSetting: async () => undefined }));

import {
  TAG_UPDATE_CHUNK,
  chunkArray,
  describeTagRewrite,
  rewriteTagList,
} from "@/lib/customer-tags-logic";
import { HEAT_POOL_LIMIT, HEAT_RPC_CHUNK } from "@/lib/customer-list-filters";
import { filterCustomersByHeatSegment } from "@/lib/customer-heat-export";

const root = path.resolve(import.meta.dirname, "../../../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

describe("etiket yeniden yazma mantığı", () => {
  it("etiketi yeniden adlandırır, büyük/küçük harf ve Türkçe i'ye duyarsızdır", () => {
    expect(rewriteTagList(["ALICI", "yatırımcı"], "alıcı", "Gold")).toEqual(["Gold", "yatırımcı"]);
    expect(rewriteTagList(["İş"], "iş", "Ofis")).toEqual(["Ofis"]);
  });

  it("hedef etiket zaten varsa birleşir (tekrar yok)", () => {
    expect(rewriteTagList(["A", "B"], "A", "B")).toEqual(["B"]);
  });

  it("silme (null) etiketi kaldırır; etiket yoksa güncelleme gerekmez", () => {
    expect(rewriteTagList(["A", "B"], "A", null)).toEqual(["B"]);
    expect(rewriteTagList(["B"], "A", null)).toBeNull();
  });

  it("parçalara böler ve sonuç mesajı kısmi hatayı açıkça söyler", () => {
    const parts = chunkArray(Array.from({ length: TAG_UPDATE_CHUNK * 2 + 1 }, (_, i) => i), TAG_UPDATE_CHUNK);
    expect(parts).toHaveLength(3);
    expect(parts[2]).toHaveLength(1);
    expect(describeTagRewrite(10, 0, 10)).toBe("10 müşteride güncellendi.");
    expect(describeTagRewrite(7, 3, 10)).toContain("3'inde hata oldu");
  });

  it("etiket action'ı müşteri başına sıralı değil parçalı yazar ve kısmi hatayı döner", () => {
    const src = read("src/app/actions/customer-tags.ts");
    expect(src).toContain("chunkArray(pending, TAG_UPDATE_CHUNK)");
    expect(src).toContain("Promise.all");
    expect(src).toContain("if (failed > 0) return { error: message");
    expect(read("src/app/app/ayarlar/etiketler/tag-manager.tsx")).toContain("parça parça güncelleniyor");
  });
});

describe("sıcaklık segmenti: ekran ve CSV aynı havuz sınırı", () => {
  it("tek kaynak sabit; ekran ve dışa aktarma ayrı sayı kullanmaz", () => {
    expect(HEAT_POOL_LIMIT).toBeGreaterThanOrEqual(HEAT_RPC_CHUNK);
    // T1: sorgular data.ts'e taşındı; sabit tanımı ne sayfada ne veri katmanında olmamalı.
    const page = read("src/app/app/musteriler/data.ts") + read("src/app/app/musteriler/page.tsx");
    const exp = read("src/lib/customer-heat-export.ts");
    expect(page).not.toMatch(/HEAT_POOL_LIMIT\s*=\s*\d/);
    expect(page).toContain(".limit(HEAT_POOL_LIMIT)");
    expect(exp).toContain(".limit(HEAT_POOL_LIMIT)");
    expect(exp).not.toMatch(/EXPORT_LIMIT\s*=\s*\d/);
  });

  it("CSV segmenti havuzu HEAT_POOL_LIMIT ile çeker, sinyalleri HEAT_RPC_CHUNK'lık dilimlerle sorar", async () => {
    const poolSize = HEAT_RPC_CHUNK + 5;
    const poolRows = Array.from({ length: poolSize }, (_, i) => ({
      id: `c${i}`,
      created_at: "2026-01-01T00:00:00.000Z",
      blacklist: false,
    }));
    let limitArg: number | null = null;
    const rpcSizes: number[] = [];
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "order", "contains", "gte", "lte", "or", "in"]) chain[m] = () => chain;
    chain.limit = (n: number) => {
      limitArg = n;
      return Promise.resolve({ data: poolRows, error: null });
    };
    const supabase = {
      from: () => chain,
      rpc: (_name: string, args: { p_customer_ids: string[] }) => {
        rpcSizes.push(args.p_customer_ids.length);
        return Promise.resolve({ data: [], error: null });
      },
    };
    const res = await filterCustomersByHeatSegment(
      supabase as never,
      { tenantId: "t1", userId: "u1", role: "owner" },
      { q: "", type: "", etiket: "", source: "", assigned: "", from: "", to: "", segment: "sicak" } as never,
      "sicak",
    );
    expect(res.error).toBeUndefined();
    expect(limitArg).toBe(HEAT_POOL_LIMIT);
    expect(rpcSizes).toEqual([HEAT_RPC_CHUNK, 5]);
  });
});

describe("içe aktarma: CSV + .xlsx (yalnız dinamik okuyucu), eski .xls için açık yönerge + şablon", () => {
  it("sihirbaz .xlsx'i dinamik okuyucuyla, CSV'yi kendi ayrıştırıcısıyla alır; .xls reddedilir; şablon indirilir", () => {
    const wiz = read("src/app/app/ice-aktarma/import-wizard.tsx");
    expect(wiz).toContain("readXlsxTable(");
    expect(wiz).toContain("isLegacyXls(file)");
    expect(wiz).toContain("buildTemplateCsv");
    expect(wiz).toMatch(/accept="\.csv,text\/csv,\.xlsx/);
    expect(wiz).toContain("Eski Excel biçimi (.xls) desteklenmiyor");
  });

  it("xlsx bağımlılığı eklenmemiştir", () => {
    const pkg = JSON.parse(read("package.json")) as { dependencies?: Record<string, string> };
    const names = Object.keys(pkg.dependencies ?? {});
    expect(names.some((n) => /^(xlsx|exceljs|sheetjs|node-xlsx)$/i.test(n))).toBe(false);
  });
});
