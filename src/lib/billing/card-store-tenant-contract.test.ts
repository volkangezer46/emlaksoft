import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * SÖZLEŞME (kart saklama tenant izolasyonu): kart deposu ve otomatik yenileme service_role istemcisini PARAMETRE olarak
 * alır (kendisi yaratmaz) ve istemci RLS'i atladığı için HER `.from(` çağrısı tenant süzgeci taşımak zorundadır:
 * `.eq("tenant_id", …)`, yazımlarda `tenant_id:` yükü ya da `tenants` tablosunda `.eq("id", tenantId)`.
 * Tek gerekçeli istisna: otomatik yenileme koşusunun, bayrak+rıza kapılı ofis TARAMASI (cron; satırlar tek tek tenant'a
 * bağlanır ve her sonraki sorgu tenant süzgeçlidir).
 */

const ROOT = process.cwd();
const FILES = [
  "src/lib/billing/card-store.ts",
  "src/lib/billing/auto-renew.ts",
  "src/app/actions/payment-cards.ts",
];

/** Gerekçeli istisnalar: dosya + tablo + ayırt edici parça. */
const EXCEPTIONS: { file: string; table: string; marker: string; why: string }[] = [
  {
    file: "src/lib/billing/auto-renew.ts",
    table: "tenant_payment_profiles",
    marker: '.eq("auto_renew_enabled", true)',
    why: "cron taraması: rızası açık TÜM ofisler; her satır sonraki sorgularda tenant süzgeciyle işlenir",
  },
];

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:'"`])\/\/.*$/gm, "$1");
}

/** `.from("x")` çağrılarını, bir sonraki `.from(` ya da `;` öncesine kadar olan zincirle döndürür. */
function fromCalls(code: string): { table: string; chain: string }[] {
  const out: { table: string; chain: string }[] = [];
  const re = /\.from\(\s*["'`]([a-z_]+)["'`]\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    const start = m.index;
    const rest = code.slice(start + m[0].length);
    const nextFrom = rest.search(/\.from\(/);
    const semi = rest.indexOf(";");
    const ends = [nextFrom, semi].filter((n) => n >= 0);
    const end = ends.length ? Math.min(...ends) : rest.length;
    out.push({ table: m[1]!, chain: rest.slice(0, end) });
  }
  return out;
}

describe("kart deposu: her .from( çağrısı tenant süzgeci taşır", () => {
  for (const rel of FILES) {
    it(rel, () => {
      const code = stripComments(readFileSync(join(ROOT, rel), "utf8"));
      const calls = fromCalls(code);
      const bad: string[] = [];
      for (const c of calls) {
        const filtered =
          /\.eq\(\s*["']tenant_id["']/.test(c.chain) ||
          /\btenant_id\s*:/.test(c.chain) ||
          (c.table === "tenants" && /\.eq\(\s*["']id["']/.test(c.chain));
        if (filtered) continue;
        const exc = EXCEPTIONS.find((e) => e.file === rel && e.table === c.table && c.chain.includes(e.marker));
        if (!exc) bad.push(`${c.table}: ${c.chain.replace(/\s+/g, " ").slice(0, 120)}`);
      }
      expect(bad).toEqual([]);
    });
  }

  it("card-store ve auto-renew kendi service_role istemcisini YARATMAZ (parametre olarak alır)", () => {
    for (const rel of ["src/lib/billing/card-store.ts", "src/lib/billing/auto-renew.ts", "src/app/actions/payment-cards.ts"]) {
      const code = stripComments(readFileSync(join(ROOT, rel), "utf8"));
      expect(code).not.toMatch(/createAdminClient/);
    }
  });

  it("kullanıcı eylemleri yalnız owner/gm RPC'leriyle yapılır (migration)", () => {
    const sql = readFileSync(join(ROOT, "supabase/migrations/20260826000700_payment_cards.sql"), "utf8")
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    for (const fn of [
      "tenant_card_user_key",
      "payment_card_provider_ref",
      "set_my_default_payment_card",
      "set_my_auto_renew_consent",
      "remove_my_payment_card",
    ]) {
      const m = sql.match(new RegExp(`create or replace function public\\.${fn}\\([\\s\\S]*?\\n\\$\\$;`));
      expect(m, fn).not.toBeNull();
      const body = m![0];
      expect(body, fn).toContain("security definer");
      expect(body, fn).toContain("set search_path = ''");
      expect(body, fn).toContain("public.current_tenant_id()");
      expect(body, fn).toContain("('owner', 'gm')");
      expect(sql, fn).toContain(`grant execute on function public.${fn}(`);
    }
  });
});
