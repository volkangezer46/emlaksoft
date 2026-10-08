import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MIGRATION_GROUP_SPEC } from "../../../scripts/migration-pairs-data";
import { CRON_JOBS } from "@/lib/cron-jobs";
import { allPortalHosts } from "./adapters/html";

/**
 * SÖZLEŞME (statik): İlan Kontrol VERİ YOLLARI (2026-10-07). Portaldan veri yalnız kullanıcının kendi tarayıcısındaki
 * eklentiyle ya da kullanıcının yüklediği listeyle gelir; sunucu portala istek atmaz; yeni service_role kullanımı yok;
 * yeni cron yok; migration'lar forward-only + rollback + PB46 penceresi.
 */
const ROOT = process.cwd();
const src = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const EXT = "extensions/emlaksoft-ilan-kontrol";
const MIGS = ["20261007000200_lc_lifecycle_events.sql", "20261007000210_lc_inventory_matching.sql", "20261007000220_lc_district_sla_reset.sql"];

describe("PB46 migration'ları", () => {
  for (const f of MIGS) {
    it(`${f}: başlık, ön koşul, lock_timeout, definer search_path, rollback, pencere`, () => {
      const t = src(`supabase/migrations/${f}`);
      expect(t).toMatch(/UYGULANMADI/);
      expect(t).toMatch(/do \$\$[\s\S]*?raise exception/i);
      expect(t).toContain("set local lock_timeout");
      const definers = t.match(/security definer/g)?.length ?? 0;
      expect(t.match(/security definer\s+set search_path = ''/g)?.length ?? 0).toBe(definers);
      expect(existsSync(join(ROOT, "supabase/rollbacks", f.replace(/\.sql$/, ".rollback.sql")))).toBe(true);
      const w = MIGRATION_GROUP_SPEC.windows.find((x) => x.files.includes(f));
      expect(w?.id).toBe("PB46-ilan-kontrol-veri-yollari");
      expect(w?.order).toBe(29.97);
      expect(MIGRATION_GROUP_SPEC.impact[f]).toBeDefined();
      expect(t).not.toMatch(/create policy [^;]* for all/i);
    });
  }
  it("yaşam döngüsü tablosu APPEND-ONLY: yalnız select verilir; RLS rol kapsamlı", () => {
    const t = src(`supabase/migrations/${MIGS[0]}`);
    expect(t).toMatch(/revoke all on table public\.lc_lifecycle_events from public, anon, authenticated, service_role/);
    expect(t).not.toMatch(/grant (all|insert|update|delete)[^;]*lc_lifecycle_events/);
    expect(t).toContain("lc_row_visible(branch_id, team_id, advisor_id)");
    expect(t).toContain("'inferred'");
  });
  it("envanter/eşleşme RPC'leri JWT kimlikli, yalnız authenticated; 'listede yok' yalnız tam listede", () => {
    const t = src(`supabase/migrations/${MIGS[1]}`);
    for (const fn of ["lc_inventory_import", "lc_match_decide"]) {
      expect(t).toMatch(new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon;`));
      expect(t).toMatch(new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to authenticated;`));
    }
    expect(t).toContain("public.current_tenant_id()");
    expect(t).toContain("has_effective_permission('portals', 'edit')");
    expect(t).toMatch(/j ->> 'result' = 'absent' and not coalesce\(p_complete, false\)/);
  });
});

describe("istemci/sunucu sınırları", () => {
  it("yeni sunucu dosyaları admin client kullanmaz ve portala istek atmaz", () => {
    for (const f of [
      "src/app/actions/listing-control-inventory.ts",
      "src/app/api/app/ilan-kontrol/isci/route.ts",
      "src/lib/listing-control/inventory-import.ts",
      "src/lib/listing-control/duplicates.ts",
      "src/lib/listing-control/server/duplicates.ts",
      "src/lib/listing-control/adapters/html/parse-core.ts",
    ]) {
      const s = src(f);
      expect(s, f).not.toMatch(/createAdminClient|supabase\/admin/);
      expect(s, f).not.toMatch(/\bfetch\s*\(/);
    }
    const a = src("src/app/actions/listing-control-inventory.ts");
    expect(a.match(/requirePermission\("portals", "edit"\)/g)?.length).toBe(2);
  });
  it("yeni cron yok: kopya taraması portal-teyit'in gece turunda, SLA görevi leak-sla'da", () => {
    expect(CRON_JOBS.length).toBe(36);
    expect(src("src/lib/listing-control/server/cron-steps.ts")).toContain("runDuplicateScan(");
    expect(src("src/lib/listing-control/server/escalate.ts")).toContain("createSlaTasks(");
    expect(src("src/lib/listing-control/server/escalate.ts")).toContain("notifyTenant(");
  });
  it("ana ekran ilan sağlığı TEK blok: yalnız ilan-sagligi.tsx; page.tsx'te tek import + tek kullanım, rol yerleşimi home-layout'tan", () => {
    const p = src("src/app/app/page.tsx");
    expect(p.match(/IlanSagligi/g)?.length).toBe(2);
    expect(p).toContain("layout.listingHealth");
    expect(p).not.toMatch(/PortfoySagligi|KayipKacak|PortalSagligi/);
    expect(src("src/app/app/_home/ilan-sagligi.tsx")).toContain("getControlSummary");
    for (const gone of ["portfoy-sagligi", "kayip-kacak", "portal-ekip"]) {
      expect(existsSync(join(ROOT, `src/app/app/_home/${gone}.tsx`)), gone).toBe(false);
    }
  });
});

describe("tarayıcı eklentisi", () => {
  it("Manifest V3; izinler yalnız storage; portal alanları adaptör kaydından", () => {
    const m = JSON.parse(src(`${EXT}/manifest.base.json`)) as Record<string, unknown>;
    expect(m.manifest_version).toBe(3);
    expect(m.permissions).toEqual(["storage"]);
    expect(allPortalHosts()).toEqual(["emlakjet.com", "hepsiemlak.com", "sahibinden.com"]);
    const b = src("scripts/build-extension.ts");
    expect(b).toContain("allPortalHosts()");
    expect(b).toContain("https://emlaksoft.vercel.app");
    expect(b).toContain("NEXT_PUBLIC_APP_URL");
  });
  it("köprü sözleşmesi uygulamadan derlenir (kopya yok); yasak teknik yok", () => {
    const content = src(`${EXT}/src/content.ts`);
    const bg = src(`${EXT}/src/background.ts`);
    expect(content).toContain('from "@/lib/listing-control/worker/bridge"');
    expect(content).toContain("emlaksoftListingBridge");
    expect(bg).toContain('credentials: "include"');
    for (const s of [content, bg]) {
      expect(s).not.toMatch(/user-agent|User-Agent|captcha.?solv|2captcha|anticaptcha|proxy/i);
      expect(s).not.toMatch(/chrome\.tabs\.create|chrome\.windows/); // sekme/pencere açmadan
    }
    expect(bg).toContain("pacingDecision(");
    expect(bg).toContain("applyBlockCooldown(");
  });
  it("derleme çıktısı depoya girmez", () => {
    expect(src(`${EXT}/.gitignore`)).toMatch(/^dist\/$/m);
    expect(src("package.json")).toContain('"build:extension"');
  });
});
