import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_SETTING_DEFS, isSecretDef, storageKeyOf } from "./registry";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(relative(ROOT, full).replace(/\\/g, "/"));
  }
  return out;
}

/**
 * Registry dışı platform_settings yazımı YASAK: yalnız src/lib/settings/** ve platform-settings.ts (düşük seviye depo).
 * LEGACY_WRITERS: henüz registry'ye taşınmamış, gerekçeli yazarlar (katı küçülen liste: taşınınca buradan SİLİN;
 * listede olup artık yazmayan dosya testi kırar). Yeni yazar eklemek testi kırar -> önce registry'ye tanım ekleyin.
 */
const WRITE_RE = /setPlatformSetting\(|from\("platform_settings"\)\s*\.(upsert|insert|update|delete)|from\("platform_settings"\)[\s\S]{0,40}\.(upsert|insert|update|delete)\(/;
const ALWAYS_ALLOWED = [/^src\/lib\/settings\//, /^src\/lib\/platform-settings\.ts$/];
const LEGACY_WRITERS: Record<string, string> = {
  "src/app/actions/platform-tufe.ts": "TÜFE tablosu (kendi ekranı, JSON)",
  "src/lib/versioned-config/store.ts": "taslak/yayın/10 kayıt geçmişi (seo, site menü, içerik); merkez köprü",
  "src/lib/site-menu/store.ts": "versioned-config tüketicisi",
  "src/lib/seo/store.ts": "versioned-config tüketicisi",
  "src/lib/brand/store.ts": "marka varlıkları (ikili veri)",
  "src/app/actions/platform-emlakfiyati.ts": "EmlakFiyatı anahtar yönetimi (sealPlatformSecret ile şifreli)",
  "src/lib/integrations/emlakfiyati/keys.ts": "EF anahtarı sealPlatformSecret ile şifreli",
  "src/lib/integrations/emlakfiyati/adapter.ts": "EF durum anahtarları",
  "src/lib/integrations/emlakfiyati/ortak-client.ts": "EF ortak istemci durum anahtarları",
  "src/app/actions/platform-billing-plans.ts": "plan/koltuk/kampanya JSON (kendi ekranı)",
  "src/app/actions/growth.ts": "büyüme bayrakları (kendi ekranı, kendi denetimi)",
  "src/app/actions/accounting.ts": "muhasebe ayarları",
  "src/app/admin/ef-kontor/actions.ts": "EF tarife/paket JSON (kendi ekranı)",
  "src/app/admin/ai-kullanim/actions.ts": "AI kredi maliyet tablosu (kendi ekranı)",
  "src/lib/insights/engine.ts": "içgörü motoru tur imleci (ayar değil, cron durum işaretçisi; tek anahtar, ofis kimliği)",
};

describe("ayar yazım sözleşmesi", () => {
  const files = walk(join(ROOT, "src"));
  const writers = files.filter((f) => WRITE_RE.test(read(f)));

  it("registry dışı platform_settings yazarı yok (yalnız gerekçeli legacy liste)", () => {
    const rogue = writers.filter((f) => !ALWAYS_ALLOWED.some((re) => re.test(f)) && !(f in LEGACY_WRITERS));
    expect(rogue, `Registry dışı yazar: ${rogue.join(", ")}`).toEqual([]);
  });

  it("legacy listesi güncel: listedeki her dosya hâlâ yazıyor", () => {
    const stale = Object.keys(LEGACY_WRITERS).filter((f) => !writers.includes(f));
    expect(stale, `Taşınmış/artık yazmayan legacy girdiler: ${stale.join(", ")}`).toEqual([]);
  });

  it("gizli ayarların depo anahtarları legacy yazarlarda YOK (sırlar yalnız writeSetting + şifreli)", () => {
    const secretStorage = ALL_SETTING_DEFS.filter(isSecretDef).map(storageKeyOf);
    for (const f of Object.keys(LEGACY_WRITERS)) {
      const src = read(f);
      for (const k of secretStorage) {
        if (k.startsWith("sahibinden") || k.startsWith("hepsiemlak") || k.startsWith("zingat") || k.startsWith("emlakjet")) continue;
        expect(src.includes(`"${k}"`), `${f} gizli anahtar ${k} yazıyor`).toBe(false);
      }
    }
  });

  it("migre edilen eylemler registry üzerinden yazar (ham setPlatformSetting yok)", () => {
    for (const f of [
      "src/app/actions/platform-settings-general.ts",
      "src/app/actions/platform-messaging-keys.ts",
      "src/app/actions/portal-keys.ts",
      "src/app/actions/ai-advisor.ts",
    ]) {
      const src = read(f);
      expect(src, f).toContain("applyPlatformWrites");
      expect(src.includes("setPlatformSetting("), f).toBe(false);
    }
  });

  it("gizli okuyucular geçiş dönemi çözücüsünü kullanır (şifreli değer ham kullanılmaz)", () => {
    expect(read("src/lib/ai-advisor.ts")).toContain('getPlatformSecret("openai_api_key")');
    expect(read("src/lib/messaging/netgsm.ts")).toContain('getPlatformSecret("netgsm_password")');
    expect(read("src/lib/messaging/netgsm.ts")).toContain('getPlatformSecret("whatsapp_api_token")');
    expect(read("src/lib/integrations/portals/index.ts")).toContain("getPlatformSecret(`${portal}_api_key`)");
    expect(read("src/lib/efatura.ts")).toContain('getPlatformSecret("efatura_api_key")');
  });

  it("log/denetim/geçmiş yazan kodlar gizli düz değeri taşımaz", () => {
    const w = read("src/lib/settings/write.ts");
    // denetim meta'sında gizli için yalnız parmak izi; düz değer alanı (plain) meta'ya girmez
    expect(w).toMatch(/secret \? \{ fingerprint:/);
    expect(w.includes("console.log")).toBe(false);
  });
});

describe("ayar migration sözleşmesi", () => {
  const hist = read("supabase/migrations/20260826002100_settings_history.sql");
  const tenant = read("supabase/migrations/20260826002200_tenant_settings.sql");
  const guard = read("supabase/migrations/20260826002300_platform_settings_guard.sql");
  const rpc = read("supabase/migrations/20260826002400_write_setting_rpc.sql");

  it("settings_history append-only: UPDATE/DELETE yetkisi yok, RLS açık, gizlide değer yasak", () => {
    expect(hist).toContain("enable row level security");
    expect(hist).not.toMatch(/grant[^;]*\b(update|delete)\b[^;]*settings_history/i);
    expect(hist).toContain("settings_history_secret_no_value_check");
    expect(hist).toContain("settings_history_lookup_idx");
  });

  it("tenant_settings: PK(tenant_id,key), RLS tenant izolasyonu, istemciye yazma yok", () => {
    expect(tenant).toContain("primary key (tenant_id, key)");
    expect(tenant).toContain("tenant_id = public.current_tenant_id()");
    expect(tenant).not.toMatch(/grant[^;]*\b(insert|update|delete)\b[^;]*tenant_settings[^;]*authenticated/i);
  });

  it("guard tetikleyicisi mevcut platform_settings'i genişletir (yeni tablo yok)", () => {
    expect(guard).toContain("add column if not exists version");
    expect(guard).toContain("add column if not exists schema_version");
    expect(guard).not.toMatch(/create table[^;]*platform_settings/i);
    expect(guard).toContain("app.settings_write");
  });

  it("RPC yalnız service_role, security definer, search_path sabit", () => {
    expect(rpc).toContain("security definer");
    expect(rpc).toContain("set search_path");
    expect(rpc).toMatch(/revoke all on function public\.write_setting[\s\S]*from public, anon, authenticated/);
    expect(rpc).toMatch(/grant execute on function public\.write_setting[\s\S]*to service_role/);
  });

  it("her migration için rollback dosyası var", () => {
    for (const n of ["20260826002100_settings_history", "20260826002200_tenant_settings", "20260826002300_platform_settings_guard", "20260826002400_write_setting_rpc"]) {
      expect(() => read(`supabase/rollbacks/${n}.rollback.sql`), n).not.toThrow();
    }
  });
});