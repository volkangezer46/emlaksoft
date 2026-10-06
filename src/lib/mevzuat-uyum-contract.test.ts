import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_MATRIX } from "./permissions";
import {
  LEAD_CONSENT_TEXT_VERSION,
  LEAD_FORM_CONSENT_TEXT,
  LEAD_FORM_MARKETING_TEXT,
  buildLeadConsentVersion,
} from "./legal-copy";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("muhasebe rolü expenses VIEW (migration 20260826001700)", () => {
  const up = read("supabase/migrations/20260826001700_accounting_expenses_view.sql");
  it("matris ve SQL aynı: yalnız view", () => {
    expect(DEFAULT_MATRIX.accounting.expenses).toEqual(["view"]);
    expect(up).toContain("('accounting', 'expenses', 'view')");
    expect(up).not.toMatch(/'accounting', 'expenses', '(create|edit|delete)'/);
    expect(up).toContain("on conflict do nothing");
    const code = up.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(code).not.toMatch(/user_permission_overrides/i);
  });
  it("rollback ve yayın penceresi kaydı var", () => {
    expect(existsSync(resolve(process.cwd(), "supabase/rollbacks/20260826001700_accounting_expenses_view.rollback.sql"))).toBe(true);
    const data = read("scripts/migration-pairs-data.ts");
    expect(data).toContain("PB22-muhasebe-gider-goruntuleme");
    expect(data).toContain("order: 29.73");
  });
});

describe("yetki belgesi alanları (migration 20260826001800)", () => {
  it("iki nullable sutun + rollback + pencere", () => {
    const up = read("supabase/migrations/20260826001800_tenant_license_details.sql");
    expect(up).toContain("add column if not exists license_title text");
    expect(up).toContain("add column if not exists license_valid_until date");
    expect(up).not.toMatch(/not null/i);
    expect(existsSync(resolve(process.cwd(), "supabase/rollbacks/20260826001800_tenant_license_details.rollback.sql"))).toBe(true);
    const data = read("scripts/migration-pairs-data.ts");
    expect(data).toContain("PB23-yetki-belgesi-alanlari");
    expect(data).toContain("order: 29.74");
  });
  it("public ilan yüzeyleri LicenseNotice gösterir", () => {
    for (const p of [
      "src/app/vitrin/[slug]/page.tsx",
      "src/app/vitrin/[slug]/[id]/page.tsx",
      "src/app/sunum/[token]/page.tsx",
      "src/app/app/portfoyler/[id]/brosur/page.tsx",
    ]) {
      const src = read(p);
      expect(src, p).toContain("<LicenseNotice");
      expect(src, p).toContain("license_no");
    }
  });
});

describe("KVKK: bilgi, zorunlu onay ve ayrı pazarlama kutusu", () => {
  it("amaç ifadesi talebe dönüş; 'tanıtım' yalnız ayrı opsiyonel kutuda", () => {
    expect(LEAD_FORM_CONSENT_TEXT).not.toMatch(/tanıtım/i);
    expect(LEAD_FORM_CONSENT_TEXT).toMatch(/talebime dönüş/);
    expect(LEAD_FORM_MARKETING_TEXT).toMatch(/isteğe bağlı/);
  });
  it("rıza kanıtı sürümü pazarlama tercihini ayırır ve 80 karakteri aşmaz", () => {
    expect(buildLeadConsentVersion(false)).toBe(LEAD_CONSENT_TEXT_VERSION);
    expect(buildLeadConsentVersion(true)).toBe(`${LEAD_CONSENT_TEXT_VERSION}+mkt`);
    expect(buildLeadConsentVersion(true).length).toBeLessThanOrEqual(80);
  });
  it("form: pazarlama kutusu varsayılan işaretsiz ve zorunlu değil; sunucu sürümü kanıta yazar", () => {
    const form = read("src/app/lead/[token]/lead-form.tsx");
    expect(form).toContain('name="marketing_opt_in" defaultChecked={false}');
    expect(form).not.toMatch(/name="marketing_opt_in"[^>]*required/);
    const route = read("src/app/api/leads/[token]/route.ts");
    expect(route).toContain("buildLeadConsentVersion(isConsentAccepted(body.marketing_opt_in))");
  });
  it("legal-copy avukat-onayı bekleme işareti taşımaz (karar 2026-10-06); evrak sayfası yer tutucuyu göstermez", () => {
    expect(read("src/lib/legal-copy.ts")).not.toContain("AVUKAT ONAYI GEREKİR");
    const page = read("src/app/evrak/[token]/page.tsx");
    expect(page).not.toContain("KVKK_PLACEHOLDER_TEXT");
    expect(page).toContain("KVKK_PLATFORM_NOTICE_HREF");
  });
});

describe("TTBS / EİDS adlandırması", () => {
  it("authority-shield iki sistemi ayırır", () => {
    const src = read("src/lib/authority-shield.ts");
    expect(src).toContain("Taşınmaz Ticareti Bilgi Sistemi");
    expect(src).toContain("Elektronik İlan Doğrulama Sistemi");
  });
  it("ürün metinlerinde 'yetki / EİDS onayı' karışıklığı kalmadı", () => {
    for (const p of [
      "src/app/actions/portal-listings.ts",
      "src/app/app/anlasmalar/yeni/new-deal-form.tsx",
      "src/app/app/portallar/portal-dialogs.tsx",
      "src/app/app/portfoyler/[id]/property-workflow.tsx",
    ]) {
      expect(read(p), p).not.toMatch(/yetki\s*\/\s*EİDS|EİDS\s*\/\s*yazılı yetki/i);
    }
  });
});
