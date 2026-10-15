import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CUSTOMER_MERGE_REF_LABELS, PROPERTY_MERGE_REF_LABELS } from "@/lib/merge-labels";

/**
 * BİRLEŞTİRME FK SÖZLEŞMESİ (CRM-G1). merge_customers v1 elle yazılmış bir tablo listesi taşıyordu; listeye eklenmeyen
 * her yeni tablo (kiracılık, malik portföyü, sunum, anket ...) birleştirmede soft-delete'li kopyada kalıyordu.
 * v2 (20261018010000) taşıma listesini pg_constraint'ten DİNAMİK kurar. Bu test:
 *  1) migration'lardaki her customers(id) / properties(id) FK'sinin önizlemede Türkçe etiketi olduğunu
 *     (`src/lib/merge-labels.ts`) — etiketsiz tablo yine taşınır ama kullanıcı "diğer kayıt" görür;
 *  2) birleştirme fonksiyonlarının son tanımının dinamik çekirdeği (merge_fk_refs) kullandığını ve elle tablo listesine
 *     dönmediğini doğrular.
 */
const MIGRATIONS = join(process.cwd(), "supabase/migrations");
const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
const sources = files.map((f) => ({ file: f, sql: readFileSync(join(MIGRATIONS, f), "utf8").replace(/--[^\n]*/g, "") }));

function fkColumns(target: "customers" | "properties"): Map<string, string> {
  const out = new Map<string, string>();
  const ref = String.raw`references\s+(?:public\.)?${target}\s*\(`;
  for (const { file, sql } of sources) {
    const add = (table: string, col: string) => {
      const key = `${table}.${col}`;
      if (!out.has(key)) out.set(key, file);
    };
    const scan = (table: string, body: string, inline: RegExp) => {
      for (const m of body.matchAll(inline)) add(table, m[1]!);
      const fk = new RegExp(String.raw`foreign\s+key\s*\(([^)]*)\)\s*${ref}([^)]*)\)`, "gi");
      for (const m of body.matchAll(fk)) {
        const cols = m[1]!.split(",").map((s) => s.trim().replace(/"/g, ""));
        const refs = m[2]!.split(",").map((s) => s.trim());
        const idx = refs.indexOf("id");
        if (idx >= 0 && cols[idx]) add(table, cols[idx]!);
      }
    };
    for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?(\w+)"?\s*\(([\s\S]*?)\n\);/gi)) {
      scan(m[1]!, m[2]!, new RegExp(String.raw`(?:^|,)\s*"?(\w+)"?\s+uuid[^,]*?${ref}\s*id\s*\)`, "gim"));
    }
    for (const m of sql.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:public\.)?(\w+)([\s\S]*?);/gi)) {
      scan(m[1]!, m[2]!, new RegExp(String.raw`add\s+column\s+(?:if\s+not\s+exists\s+)?"?(\w+)"?\s+uuid[^,]*?${ref}\s*id\s*\)`, "gi"));
    }
  }
  return out;
}

function lastDefinition(fn: string): { file: string; sql: string } | null {
  let last: { file: string; sql: string } | null = null;
  const re = new RegExp(String.raw`create\s+(?:or\s+replace\s+)?function\s+public\.${fn}\s*\(`, "i");
  for (const s of sources) if (re.test(s.sql)) last = s;
  return last;
}

describe("birleştirme FK sözleşmesi", () => {
  it("customers(id)'ye FK veren her sütunun önizleme etiketi var", () => {
    const fks = fkColumns("customers");
    expect(fks.size).toBeGreaterThan(30);
    const missing = [...fks].filter(([k]) => !(k in CUSTOMER_MERGE_REF_LABELS)).map(([k, f]) => `${k} (${f})`);
    expect(missing, "src/lib/merge-labels.ts CUSTOMER_MERGE_REF_LABELS'a etiket ekleyin").toEqual([]);
  });

  it("properties(id)'ye FK veren her sütunun önizleme etiketi var", () => {
    const fks = fkColumns("properties");
    expect(fks.size).toBeGreaterThan(30);
    const missing = [...fks].filter(([k]) => !(k in PROPERTY_MERGE_REF_LABELS)).map(([k, f]) => `${k} (${f})`);
    expect(missing, "src/lib/merge-labels.ts PROPERTY_MERGE_REF_LABELS'a etiket ekleyin").toEqual([]);
  });

  it("v1'in bildiği tablolar dinamik listede de var (kapsam daralmadı)", () => {
    const fks = fkColumns("customers");
    for (const t of ["customer_demands", "calls", "appointments", "offers", "contracts", "deals", "tasks", "communications", "customer_files", "payment_links", "customer_portal_tokens", "iys_consents", "portal_match_feedback", "lost_sale_dismissals"]) {
      expect(fks.has(`${t}.customer_id`), t).toBe(true);
    }
    for (const k of ["rentals.renter_customer_id", "properties.owner_customer_id", "presentations.customer_id", "referrals.referrer_customer_id"]) {
      expect(fks.has(k), k).toBe(true);
    }
  });

  it("merge_customers ve merge_properties son tanımı dinamik çekirdeği kullanır; elle tablo listesi yok", () => {
    for (const [fn, target] of [["merge_customers", "customers"], ["merge_properties", "properties"]] as const) {
      const def = lastDefinition(fn);
      expect(def, fn).not.toBeNull();
      const body = def!.sql.slice(def!.sql.search(new RegExp(String.raw`function\s+public\.${fn}\s*\(`, "i")));
      expect(body, `${fn} (${def!.file})`).toMatch(new RegExp(String.raw`public\.merge_fk_refs\(\s*'${target}'`));
      expect(body, `${fn} (${def!.file}) elle tablo dizisine dönmemeli`).not.toMatch(/foreach\s+\w+\s+in\s+array\s+array\[\s*'customer_demands'/i);
    }
    const core = lastDefinition("merge_fk_refs");
    expect(core!.sql).toMatch(/pg_catalog\.pg_constraint/);
    expect(core!.sql).toMatch(/contype\s*=\s*'f'/);
  });
});
