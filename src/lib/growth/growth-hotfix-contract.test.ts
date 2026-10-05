import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 20260826000900 growth hotfix: STATİK sözleşme (DB gerektirmez). SQL'in kendisi sahibin kontrollü penceresinde uygulanır;
 * burada yalnız dosyanın bütünlüğü (md5 koruması, grant, rollback, TS kancaları) doğrulanır.
 */
const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8").replace(/\r/g, "");
const SQL = read("supabase/migrations/20260826000900_growth_hotfix.sql");
const BASE = read("supabase/migrations/20260826000600_growth_referral_engine.sql");
const ROLLBACK = read("supabase/rollbacks/20260826000900_growth_hotfix.rollback.sql");

const REPLACED = [
  "growth_real_payment",
  "growth_register_referral",
  "growth_register_partner",
  "growth_grant_welcome",
  "growth_reverse_claims",
  "growth_grant_claim",
  "growth_claims_process",
  "growth_my_dashboard",
  "growth_invite_preview",
] as const;
const NEW_HELPERS = [
  "growth_referred_qualified",
  "growth_renewal_ok",
  "growth_referred_ready",
  "growth_returning_customer",
  "growth_welcome_apply",
  "growth_tier_revalidate",
] as const;

function body(src: string, fn: string): string {
  const i = src.indexOf(`create or replace function public.${fn}(`);
  expect(i, fn).toBeGreaterThanOrEqual(0);
  const a = src.indexOf("as $$", i) + 5;
  return src.slice(a, src.indexOf("$$;", a));
}
const md5 = (s: string) => createHash("md5").update(s).digest("hex");

describe("growth hotfix SQL", () => {
  it("on-kosul blogu: taban md5 = 000600 govdesi, yeni md5 = bu dosyanin govdesi", () => {
    for (const fn of REPLACED) {
      const m = new RegExp(`\\('${fn}',\\s+'([0-9a-f]{32})',\\s+'([0-9a-f]{32})'\\)`).exec(SQL);
      expect(m, fn).not.toBeNull();
      expect(m![1], `${fn} taban`).toBe(md5(body(BASE, fn)));
      expect(m![2], `${fn} yeni`).toBe(md5(body(SQL, fn)));
    }
    expect(SQL).not.toMatch(/@MD5_/);
  });

  it("yeni yardimcilar yalniz service_role; mevcut grant'lar korunur (grant dongusu YOK)", () => {
    for (const fn of NEW_HELPERS) {
      expect(SQL).toMatch(new RegExp(`create or replace function public\\.${fn}\\(`));
      expect(SQL).toMatch(new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated`));
      expect(SQL).toMatch(new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to service_role`));
      expect(SQL).not.toMatch(new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to (anon|authenticated)`));
    }
    expect(SQL).not.toMatch(/\bdrop function\b/i);
    expect(SQL).not.toMatch(/\bcreate table\b|\balter table\b/i);
  });

  it("B1: ilk-N sayaci yalniz personelce onayli talepleri sayar", () => {
    const b = body(SQL, "growth_register_referral");
    expect(b).toMatch(/c\.status in \('approved', 'paid'\)/);
    expect(b).toMatch(/e\.event = 'approved' and e\.actor_id is not null/);
    expect(b).not.toContain("not in ('rejected', 'reversed')");
  });

  it("B2: odul kapisi eligible_at + davet edilen hazirligi (isleyici ve grant_claim)", () => {
    expect(body(SQL, "growth_grant_claim")).toContain("c.eligible_at > now()");
    expect(body(SQL, "growth_grant_claim")).toContain("growth_referred_ready");
    const p = body(SQL, "growth_claims_process");
    expect(p).toContain("x.eligible_at <= now()");
    expect(p).toContain("growth_referred_ready(x.referred_tenant_id, x.invoice_id, x.component)");
  });

  it("B3: hos geldin kredisi ilk odemede; kayit aninda verilmez", () => {
    const w = body(SQL, "growth_welcome_apply");
    expect(w).toContain("awaiting_first_payment");
    expect(w).toContain("referrer_not_paying");
    expect(w).toContain("returning_customer");
    expect(body(SQL, "growth_register_referral")).toContain("growth_welcome_apply(i.tenant_id)");
    expect(body(SQL, "growth_grant_welcome")).toContain("auth.role() is distinct from 'service_role'");
  });

  it("B5/B10: chargeback gercek odeme degil; kredi kullanimi bayragi", () => {
    expect(body(SQL, "growth_real_payment")).toContain("i.meta -> 'chargeback' is not null");
    expect(body(SQL, "growth_claims_process")).toContain("i.meta -> 'chargeback' is not null");
    expect(body(SQL, "growth_register_referral")).toContain("'credit_used'");
    expect(body(SQL, "growth_register_referral")).not.toContain("low_cash_ratio");
  });

  it("B9: bonus yalniz nitelikli (aktif + >=2 odeme) davetleri sayar ve esik altinda geri alinir", () => {
    expect(body(SQL, "growth_claims_process")).toContain("growth_referred_qualified(b.referred_tenant_id)");
    expect(body(SQL, "growth_reverse_claims")).toContain("growth_tier_revalidate");
  });

  it("B12/B16: panel TL gizliligi + onizleme siki kod ve odeyen davetci", () => {
    expect(body(SQL, "growth_my_dashboard")).toContain("pr.role in ('owner', 'gm')");
    expect(body(SQL, "growth_invite_preview")).toContain("^[a-z0-9]{8}$");
    expect(body(SQL, "growth_invite_preview")).toContain("growth_real_payment");
  });

  it("rollback: 9 orijinal govde + yeni yardimcilari dusurur", () => {
    for (const fn of REPLACED) expect(md5(body(ROLLBACK, fn)), fn).toBe(md5(body(BASE, fn)));
    for (const fn of NEW_HELPERS) expect(ROLLBACK).toContain(`drop function if exists public.${fn}(`);
  });
});

describe("growth hotfix TS kancalari", () => {
  it("admin ters ibraz eylemi ve iyzico webhook'u talepleri geri alir", () => {
    const action = read("src/app/actions/platform-billing.ts");
    // Ters ibraz, kabul listesine yeni service_role satırı eklememek için recordInvoiceRefund içinde kind=chargeback modudur;
    // recordInvoiceChargeback yalnız ince bir sarmalayıcıdır.
    const wrapperStart = action.indexOf("export async function recordInvoiceChargeback");
    const wrapper = action.slice(wrapperStart, action.indexOf("const CAPTURE_ACTIONS", wrapperStart));
    expect(wrapper).toContain('fd.set("kind", "chargeback")');
    expect(wrapper).not.toContain("createAdminClient");
    const fn = action.slice(action.indexOf("export async function recordInvoiceRefund"), action.indexOf("export async function recordInvoiceChargeback"));
    expect(fn).toContain('guard(isChargeback ? "chargeback" : "refund", true)');
    expect(fn).toContain("reason.length < 3");
    expect(fn).toContain('reverseClaimsForInvoiceSafe(admin, invoiceId, "chargeback")');
    const hook = read("src/app/api/iyzico/webhook/route.ts");
    expect(hook).toMatch(/chargeback\|dispute/);
    expect(hook).toContain('reverseClaimsForInvoiceSafe(admin, inv.id as string, "chargeback")');
  });

  it("iade idem anahtari faturaya + onceki geri yazima bagli (tutara degil)", () => {
    const action = read("src/app/actions/platform-billing.ts");
    expect(action).toContain("admin-from-${Math.round(alreadyRestored * 100)}");
    expect(action).not.toContain("admin-${Math.round(restore * 100)}");
  });
});
