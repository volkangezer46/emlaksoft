import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { KNOWN_SEED_GAPS, NEW_TABLE_RULE_AFTER, SAMPLE_ENTITIES, SAMPLE_EXEMPT } from "./registry";

/**
 * ÖRNEK VERİ KAYIT DEFTERİ SÖZLEŞMESİ (sahip kuralı: yeni modül/varlık = aynı değişiklikte demo verisi). Kırılırsa:
 * docs/design/DEMO_VERISI.md "Yeni modül eklerken demo verisi" adımlarını izleyin.
 */
const root = process.cwd();
const migDir = resolve(root, "supabase/migrations");
const files = readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort();
const sql = (f: string) => readFileSync(join(migDir, f), "utf8");
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");

/** Migration'larda `is_sample` sütunu kazanan tablolar (alter ... add column is_sample + create table içi sütun). */
function tablesWithIsSample(): Set<string> {
  const out = new Set<string>();
  for (const f of files) {
    const s = sql(f);
    for (const m of s.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?([a-z_]+)\s+add\s+column\s+(?:if\s+not\s+exists\s+)?is_sample\b/gi)) out.add(m[1]!.toLowerCase());
    for (const m of s.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_]+)\s*\(([\s\S]*?)\n\);/gi)) {
      if (/^\s*is_sample\s+boolean/im.test(m[2]!)) out.add(m[1]!.toLowerCase());
    }
  }
  return out;
}

/** Son purge_tenant_sample_data gövdesi (en yüksek sürümlü tanım). */
function latestPurgeBody(): string {
  let body = "";
  for (const f of files) {
    const s = sql(f);
    const i = s.indexOf("create or replace function public.purge_tenant_sample_data(");
    if (i < 0) continue;
    body = s.slice(i, s.indexOf("$$;", s.indexOf("as $$", i)));
  }
  return body;
}

describe("örnek veri kayıt defteri", () => {
  const registered = new Set(SAMPLE_ENTITIES.map((e) => e.table));

  it("is_sample sütunu olan HER tablo kayıt defterinde ya da gerekçeli muafiyette", () => {
    const missing = [...tablesWithIsSample()].filter((t) => !registered.has(t) && !(t in SAMPLE_EXEMPT));
    expect(missing, `Kayıt defterine (src/lib/sample-data/registry.ts) ekleyin: ${missing.join(", ")}`).toEqual([]);
  });

  it("her tohum referansı gerçek bir dosyada tabloyu yazıyor; tohumsuz satır yalnız dondurulmuş eksik listesinde", () => {
    for (const e of SAMPLE_ENTITIES) {
      if (e.seed.kind === "derived") {
        expect(e.seed.reason.length, e.table).toBeGreaterThan(10);
        continue;
      }
      if (e.seed.group === "GAP") {
        expect(KNOWN_SEED_GAPS, `${e.table}: tohum yok ve bilinen eksik listesinde değil`).toContain(e.table);
        continue;
      }
      const src = read(e.seed.file);
      const writes = e.table === "profiles" ? src.includes('from("profiles").upsert') : src.includes(`"${e.table}"`);
      expect(writes, `${e.table}: ${e.seed.file} bu tabloya yazmıyor`).toBe(true);
    }
  });

  it("bilinen tohum eksikleri listesi BÜYÜYEMEZ (yalnız kapanır)", () => {
    const frozen = ["finance_budgets", "document_requests", "document_request_files", "rental_application_links", "rental_applications", "rental_inspections"];
    for (const t of KNOWN_SEED_GAPS) expect(frozen, `${t} yeni eksik olamaz: tohumunu yazın`).toContain(t);
  });

  it("her purge referansı son purge_tenant_sample_data gövdesinde karşılık buluyor", () => {
    const body = latestPurgeBody();
    expect(body.length).toBeGreaterThan(100);
    for (const e of SAMPLE_ENTITIES) {
      if (e.purge.kind === "rpc") expect(body, e.table).toContain(`delete from public.${e.table} where is_sample = true and tenant_id = p_tenant_id;`);
      else if (e.purge.kind === "rpc-optional") expect(body, e.table).toContain(`'${e.table}:is_sample'`);
      else if (e.purge.kind === "cascade") expect(registered.has(e.purge.parent), `${e.table} ebeveyni ${e.purge.parent} kayıtlı değil`).toBe(true);
      else if (e.purge.kind === "personas") expect(body).toMatch(/from public\.profiles p where p\.tenant_id = p_tenant_id and p\.is_sample = true/);
    }
  });

  it(`kesim sürümünden (${NEW_TABLE_RULE_AFTER}) sonra açılan tenant tablosu ya örnek veri alır ya da gerekçeli muaftır`, () => {
    const offenders: string[] = [];
    for (const f of files.filter((x) => x.slice(0, 14) > NEW_TABLE_RULE_AFTER)) {
      for (const m of sql(f).matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_]+)\s*\(([\s\S]*?)\n\);/gi)) {
        const t = m[1]!.toLowerCase();
        if (!/\btenant_id\b/.test(m[2]!)) continue;
        if (registered.has(t) || t in SAMPLE_EXEMPT) continue;
        offenders.push(`${t} (${f})`);
      }
    }
    expect(offenders, "Yeni tenant tablosu: is_sample + tohum + purge ekleyin ya da SAMPLE_EXEMPT'e gerekçe yazın").toEqual([]);
  });
});
