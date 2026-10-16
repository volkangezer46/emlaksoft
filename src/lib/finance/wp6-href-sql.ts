import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * TEST YARDIMCISI: WP6 rota taşıma migration'ının (20261020000000_finance_hrefs) saklanmış bağlantı eşleme fonksiyonu
 * (`pg_temp.finance_wp6_href`). Eski migration'ların ürettiği href'leri pglite'ta yeni yollara çevirip doğrulamak için.
 */
export const WP6_HREF_MIGRATION = "supabase/migrations/20261020000000_finance_hrefs.sql";

export function wp6HrefFunctionSql(): string {
  const sql = readFileSync(resolve(process.cwd(), WP6_HREF_MIGRATION), "utf8");
  const start = sql.indexOf("create or replace function pg_temp.finance_wp6_href");
  const end = sql.indexOf("$f$;", start) + "$f$;".length;
  if (start < 0 || end < start) throw new Error("finance_wp6_href tanımı bulunamadı");
  return sql.slice(start, end);
}
