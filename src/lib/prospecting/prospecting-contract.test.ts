import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_MATRIX } from "@/lib/permissions";
import { MODULES } from "@/lib/modules/registry";
import { TENANT_REPORT_LIST } from "@/lib/report-center/registry";
import { TENANT_ID, USER_ID, eqCalls, testCtx } from "@/lib/report-center/test-support";

/**
 * Sahibinden ilanlar (portföy avı) SÖZLEŞMESİ — kasıtlı kısıtlar (tasarım: docs/design/FSBO_ARASTIRMA_2026-10.md):
 * kazıma yok, toplu mesaj yok, kampanya hedef kitlesi değil, vitrine girmez, her sorgu kiracı filtreli, her eylem yetkili.
 */
const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(rel);
  }
  return out;
};

const PROSPECTING_SOURCES = [
  ...walk("src/lib/prospecting"),
  ...walk("src/app/app/portfoy-avi"),
  ...walk("src/app/api/app/portfoy-avi"),
  "src/app/actions/prospecting.ts",
  "src/lib/insights/prospecting-facts.ts",
  "src/lib/insights/rules/prospecting.ts",
  "src/lib/report-center/catalog/tenant-prospecting.ts",
];

describe("portföy avı: kazıma ve toplu iletişim yok", () => {
  it("portal host'larına sunucu tarafı fetch yok", () => {
    for (const f of PROSPECTING_SOURCES) {
      const src = read(f);
      expect(/\bfetch\(/.test(src), `${f}: fetch kullanımı`).toBe(false);
      expect(/https?:\/\/(?:www\.)?(?:sahibinden|hepsiemlak|emlakjet)\.com/.test(src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/placeholder="[^"]*"/g, "").replace(/hint="[^"]*"/g, "")), `${f}: portal adresi`).toBe(false);
    }
  });

  it("SMS / WhatsApp / e-posta gönderimi ve service_role kullanılmaz", () => {
    for (const f of PROSPECTING_SOURCES) {
      const src = read(f);
      expect(/sendSms|sendWhatsapp|netgsm|sendEmail|createAdminClient\(|supabase\/admin/i.test(src), `${f}: mesaj/admin istemcisi`).toBe(false);
    }
  });

  it("kampanya ve otomasyon motoru fsbo_leads'i hedef kitle olarak görmez", () => {
    const targets = [...walk("src/app/actions").filter((f) => /campaign|automation/i.test(f)), ...walk("src/lib").filter((f) => /campaign|automation/i.test(f) && !f.includes("prospecting"))];
    expect(targets.length).toBeGreaterThan(0);
    for (const f of targets) expect(/fsbo_leads|fsbo_lead_/.test(read(f)), `${f}`).toBe(false);
  });

  it("dönüşmemiş aday vitrine/sitemap'e giremez: public yüzeyler fsbo tablolarını okumaz", () => {
    const publicFiles = [...walk("src/app").filter((f) => /vitrin|sitemap|robots/.test(f)), ...walk("src/lib/seo")];
    expect(publicFiles.length).toBeGreaterThan(0);
    for (const f of publicFiles) expect(/fsbo_leads/.test(read(f)), f).toBe(false);
  });
});

describe("portföy avı: kiracı sınırı ve yetki", () => {
  it("her fsbo_* sorgusu aynı ifade zincirinde tenant_id süzer (ya da açıkça kiracı parametresi taşır)", () => {
    const files = PROSPECTING_SOURCES.filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
    for (const f of files) {
      const src = read(f);
      const calls = [...src.matchAll(/\.from\("(fsbo_[a-z_]+)"\)/g)];
      for (const m of calls) {
        const window = src.slice(m.index ?? 0, (m.index ?? 0) + 900);
        expect(/tenant_id|tenantId/.test(window), `${f}: ${m[1]} sorgusunda kiracı süzgeci yok`).toBe(true);
      }
    }
  });

  it("her sunucu eylemi requirePermission('prospecting', ...) ile başlar", () => {
    const src = read("src/app/actions/prospecting.ts");
    const fns = [...src.matchAll(/export async function (\w+)\(/g)].map((m) => m[1]);
    expect(fns.length).toBeGreaterThanOrEqual(10);
    for (const name of fns) {
      const start = src.indexOf(`export async function ${name}(`);
      const body = src.slice(start, start + 500);
      expect(/requirePermission\("prospecting"/.test(body), `${name}: yetki kapısı`).toBe(true);
    }
  });

  it("kaydet API ucu oturum + aynı köken + yetki + hız sınırı ister", () => {
    const src = read("src/app/api/app/portfoy-avi/kaydet/route.ts");
    for (const must of ["isSameOriginBridgeRequest", "getRequestUser", "checkRateLimit", 'requirePermission("prospecting", "create")']) expect(src).toContain(must);
  });

  it("aranmasın kilidi: arama sonucu, görev ve randevu eylemleri bayrağı kontrol eder", () => {
    const src = read("src/app/actions/prospecting.ts");
    expect(src.match(/isDoNotCall\(/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(src).toContain("doNotCall: dnc");
  });

  it("aranmasın kaydını yalnız yönetici kaldırır; dönüştürme çağrı merkezine kapalı", () => {
    expect(read("src/app/actions/prospecting.ts")).toContain("Aranmasın kaydını yalnız yönetici kaldırabilir");
    expect(read("src/lib/prospecting/convert.ts")).toContain('input.role === "call_center"');
  });

  it("varsayılan izin matrisi: call_center arar/not tutar ama silemez; muhasebe göremez; readonly yalnız görür", () => {
    expect(DEFAULT_MATRIX.call_center.prospecting).toEqual(["view", "create", "edit"]);
    expect(DEFAULT_MATRIX.advisor.prospecting).toEqual(["view", "create", "edit"]);
    expect(DEFAULT_MATRIX.accounting.prospecting).toBeUndefined();
    expect(DEFAULT_MATRIX.readonly.prospecting).toEqual(["view"]);
    expect(DEFAULT_MATRIX.owner.prospecting).toEqual(["view", "create", "edit", "delete"]);
  });

  it("izin seed migration'ı matrisle birebir (yeni migration, uygulanmış dosya değişmedi)", () => {
    const sql = read("supabase/migrations/20261012002410_fsbo_permission_defaults.sql");
    for (const role of ["owner", "gm", "branch_manager", "team_lead", "advisor", "call_center", "readonly"]) expect(sql).toContain(`'${role}'`);
    expect(sql).not.toContain("'accounting'");
  });

  it("tablolar migration'ında RLS + kiracı politikası + açık grant (authenticated ve service_role)", () => {
    const sql = read("supabase/migrations/20261012002400_fsbo_leads.sql");
    for (const t of ["fsbo_leads", "fsbo_lead_observations", "fsbo_lead_activities", "fsbo_do_not_call"]) {
      expect(sql).toContain(`alter table public.${t} enable row level security`);
      expect(sql).toMatch(new RegExp(`grant [a-z, ]+ on public\\.${t} to authenticated`));
      expect(sql).toMatch(new RegExp(`grant [a-z, ]+ on public\\.${t} to service_role`));
    }
    expect(sql).toContain("public.current_tenant_id()");
    // Ham telefon aranmasın tablosunda tutulmaz.
    const dnc = sql.slice(sql.indexOf("create table if not exists public.fsbo_do_not_call"), sql.indexOf("comment on table public.fsbo_do_not_call"));
    expect(dnc).toContain("phone_hash");
    expect(/\bphone\s+text/.test(dnc)).toBe(false);
  });
});

describe("portföy avı: modül kaydı ve rapor", () => {
  it("modül aç/kapa kaydı: yol, paket ve durdurulan şeyler", () => {
    const m = MODULES.find((x) => x.key === "prospecting");
    expect(m?.routes).toEqual(["/app/portfoy-avi"]);
    expect(m?.stops).toContain("içgörü");
  });

  it("rapor: kiracı sınırı + danışman kapsamı + kişisel veri kolonu yok", async () => {
    const def = TENANT_REPORT_LIST.find((r) => r.id === "sahibinden-ilan-hunisi")!;
    expect(def.module).toBe("prospecting");
    expect(def.personalData).toBeUndefined();
    expect(def.columns.some((c) => /telefon|ad soyad|e-posta/i.test(c.label))).toBe(false);
    if (def.source.kind !== "compute") throw new Error("compute bekleniyordu");
    const adv = testCtx({ officeWide: false });
    await def.source.run(adv.ctx, {});
    expect(eqCalls(adv.calls)).toContainEqual(["tenant_id", TENANT_ID]);
    expect(eqCalls(adv.calls).filter(([, v]) => v === USER_ID).length).toBeGreaterThan(0);
    const office = testCtx({ officeWide: true, seeAllEarnings: true });
    await def.source.run(office.ctx, {});
    expect(eqCalls(office.calls).filter(([, v]) => v === USER_ID)).toEqual([]);
  });

  it("kaynak dosyalarında doğrudan Date.now()/new Date() yok (clock.ts)", () => {
    for (const f of PROSPECTING_SOURCES.filter((x) => x.endsWith(".tsx"))) {
      expect(/Date\.now\(\)|new Date\(\)/.test(read(f)), f).toBe(false);
    }
    // Sayfa/lib dosyaları clock yardımcılarını kullanır; elle new Date(boş) kullanılmaz.
    for (const f of PROSPECTING_SOURCES) expect(/Date\.now\(\)/.test(read(f)), f).toBe(false);
    expect(relative(ROOT, join(ROOT, "src/lib/clock.ts"))).toBe(join("src", "lib", "clock.ts"));
  });
});
