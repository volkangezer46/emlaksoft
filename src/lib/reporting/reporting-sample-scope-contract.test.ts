import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SAMPLE_DATA_LABEL, SAMPLE_KPI_THRESHOLD, aggregateSampleLabel, includeSample } from "@/lib/sample-scope";

/**
 * Rapor/komisyon SQL toplulaştırmaları örnek veri kapsamı (20261006000710).
 * Kural `src/lib/sample-scope.ts` ile aynı olmalı: gerçek müşteri VE portföy sayısı eşiğin altındaysa örnek kayıtlar
 * dahil. Eşik RPC parametresidir; varsayılanı TS sabitine eşittir. is_sample taşıyan her tablo okuması süzgeçlidir.
 */
const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20261006000710_reporting_aggregates_sample_scope.sql"),
  "utf8",
).replace(/\r\n/g, "\n");

const FLAGGED = ["customers", "properties", "customer_demands", "appointments", "deals", "commissions", "calls", "expenses"];

function body(fn: string): string {
  const start = sql.indexOf(`create or replace function public.${fn}(`);
  const open = sql.indexOf("$$", start);
  return sql.slice(start, sql.indexOf("$$", open + 2));
}

describe("tenant_*_aggregates örnek veri kapsamı", () => {
  for (const fn of ["tenant_commission_aggregates", "tenant_reporting_aggregates"]) {
    const b = body(fn);

    it(`${fn}: eşik parametresi ve varsayılanı TS sabitiyle aynı`, () => {
      expect(b).toContain(`p_sample_threshold integer default ${SAMPLE_KPI_THRESHOLD}`);
      expect(b).toContain(`greatest(coalesce(p_sample_threshold, ${SAMPLE_KPI_THRESHOLD}), 0)`);
      expect(b).toContain("v_include := (v_real_customers < v_threshold and v_real_properties < v_threshold);");
      expect(b).toContain("'sample_included', v_include");
    });

    it(`${fn}: tenant + izin kapısı ve güvenli search_path korunur`, () => {
      expect(b).toContain("v_tenant uuid := public.current_active_tenant_id();");
      expect(b).toMatch(/public\.has_effective_permission\('(commissions|reports)', 'view'\)/);
      expect(b).toContain("security definer");
      expect(b).toContain("set search_path = ''");
    });

    it(`${fn}: is_sample taşıyan her tablo okuması süzgeçli`, () => {
      const re = new RegExp(`from public\\.(${FLAGGED.join("|")}) (\\w+)`, "g");
      const hits = [...b.matchAll(re)];
      expect(hits.length).toBeGreaterThan(2);
      for (const m of hits) {
        const rest = b.slice(m.index!);
        const next = rest.indexOf("from public.", 5);
        const segment = next > 0 ? rest.slice(0, next) : rest;
        expect(segment, `${fn}: ${m[0]}`).toContain(`${m[2]}.is_sample = false`);
      }
    });
  }

  it("eski tek argümanlı imzalar düşer, yenileri yalnız authenticated'a açılır", () => {
    expect(sql).toContain("drop function if exists public.tenant_commission_aggregates(timestamptz);");
    expect(sql).toContain("drop function if exists public.tenant_reporting_aggregates(timestamptz);");
    expect(sql).toContain("revoke all on function public.tenant_reporting_aggregates(timestamptz, integer) from public, anon;");
    expect(sql).toContain("grant execute on function public.tenant_commission_aggregates(timestamptz, integer) to authenticated;");
    expect(sql).not.toMatch(/to anon/);
  });
});

describe("aggregateSampleLabel", () => {
  it("örnek veri yüklü değilse etiket yok", () => {
    expect(aggregateSampleLabel(false, true)).toBeNull();
    expect(aggregateSampleLabel(false, undefined)).toBeNull();
  });
  it("RPC dahil ettiyse ya da karar yoksa (migration öncesi) etiketlenir; dışladıysa etiket yok", () => {
    expect(aggregateSampleLabel(true, true)).toBe(SAMPLE_DATA_LABEL);
    expect(aggregateSampleLabel(true, undefined)).toBe(SAMPLE_DATA_LABEL);
    expect(aggregateSampleLabel(true, false)).toBeNull();
  });
  it("SQL kuralı includeSample ile aynı sınırda karar verir", () => {
    expect(includeSample({ realCustomers: SAMPLE_KPI_THRESHOLD - 1, realProperties: 0 })).toBe(true);
    expect(includeSample({ realCustomers: SAMPLE_KPI_THRESHOLD, realProperties: 0 })).toBe(false);
  });
});
