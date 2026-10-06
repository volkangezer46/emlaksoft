import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BUSINESS_PLAN_TEMPLATE, DEFAULT_YEARLY_PAID_MONTHS, PLANS, planAmountOf, planAmountTry } from "./plans";

/**
 * Plan değişiminde abonelik tutarı sözleşmesi (HAFIZA §3 "Fiyat kararı", 2026-10-06 denetimi).
 *
 * `update_tenant_plan_subscription`'ın SON tanımı (migrations içinde en son `create or replace` eden dosya):
 *  - plan DEĞİŞMİYORSA kayıtlı `amount_try` ve `price_lock_*` korunur (yalnız durum değişimi tutarı ezmez);
 *  - plan değişirse tutar `plan_monthly_amount()`'tan, Founders kilidi yeni planın kampanya fiyatına yeniden yazılır;
 *  - eski 990/2490/5990/12900 sabitleri YOKTUR.
 * Kalan son eski-sabit yolu (9 argümanlı fulfill overload'u) 20261006000700'de düşürülür; geri alma dosyası onu
 * 20260731000138'deki gövdeyle bayt bayt geri getirir.
 */

const MIG = resolve(process.cwd(), "supabase/migrations");
const RB = resolve(process.cwd(), "supabase/rollbacks");
const files = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
const read = (dir: string, f: string) => readFileSync(resolve(dir, f), "utf8").replace(/\r\n/g, "\n");

function lastDefinition(fn: string): { file: string; body: string } {
  const head = `create or replace function public.${fn}(`;
  const owners = files.filter((f) => read(MIG, f).toLowerCase().includes(head));
  const file = owners[owners.length - 1]!;
  const sql = read(MIG, file);
  const start = sql.toLowerCase().lastIndexOf(head);
  const open = sql.indexOf("$$", start);
  const close = sql.indexOf("$$", open + 2);
  return { file, body: sql.slice(start, close + 2) };
}

describe("update_tenant_plan_subscription: kayıtlı/kilitli fiyat korunur", () => {
  const { file, body } = lastDefinition("update_tenant_plan_subscription");

  it("son tanım fiyat bütünlüğü migration'ıdır (sonraki bir dosya eski gövdeyi geri getirmedi)", () => {
    expect(file).toBe("20260825000300_billing_plan_amount_integrity.sql");
  });

  it("eski sabit tutarlar yok; tutar plan tanımından gelir", () => {
    expect(body).not.toMatch(/when\s+'(advisor|office|professional|business|enterprise)'\s+then\s+\d/);
    expect(body).toContain("public.plan_monthly_amount(v_next_plan)");
  });

  it("plan değişmiyorsa kayıtlı tutar ve kilit korunur", () => {
    expect(body).toContain("v_plan_changed := v_next_plan is distinct from coalesce(v_sub_plan, v_old_plan);");
    expect(body).toMatch(/else\s+-- Ayni plan[\s\S]*?v_lock_try := v_old_lock_try;[\s\S]*?v_amount_try := v_old_amount_try;/);
  });

  it("plan değişiminde Founders kilidi yeni planın kampanya fiyatına yazılır ve price_lock_* güncellenir", () => {
    expect(body).toContain("public.plan_campaign_lock_amount(v_next_plan)");
    expect(body).toContain("price_lock_try = v_lock_try");
    expect(body).toContain("price_lock_campaign = v_lock_campaign");
  });

  it("yalnız service_role + aktif faturalama personeli çağırır", () => {
    expect(body).toContain("auth.role() is distinct from 'service_role'");
    expect(body).toContain("ps.role in ('super_admin', 'billing')");
    expect(body).toContain("set search_path = ''");
  });
});

describe("20261006000700: eski 9 argümanlı fulfill overload'u düşer", () => {
  const sql = read(MIG, "20261006000700_fix_plan_subscription_amount.sql");
  const rollback = read(RB, "20261006000700_fix_plan_subscription_amount.rollback.sql");
  const legacy = read(MIG, "20260731000138_atomic_billing_fulfillment.sql");

  it("yalnız 9 argümanlı imzayı düşürür, 10 argümanlı tanıma dokunmaz", () => {
    expect(sql).toContain(
      "drop function if exists public.fulfill_billing_payment(text, text, text, text, text, uuid, text, text, numeric);",
    );
    expect(sql).not.toMatch(/drop function[^;]*numeric, text\)/);
    expect(sql).not.toMatch(/create or replace function/i);
    const code = sql.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
    expect(code).not.toMatch(/concurrently/i);
  });

  it("ön koşul: 000300 uygulanmamışsa (eski sabitli gövde) hiçbir şey yazmadan durur", () => {
    expect(sql).toContain("position('public.plan_monthly_amount(' in v_body) = 0");
    expect(sql).toContain("to_regprocedure('public.fulfill_billing_payment(text, text, text, text, text, uuid, text, text, numeric, text)') is null");
  });

  it("geri alma eski overload gövdesini 20260731000138'den bayt bayt geri getirir", () => {
    const start = legacy.indexOf("create or replace function public.fulfill_billing_payment(");
    const end = legacy.indexOf("notify pgrst, 'reload schema';", start);
    expect(start).toBeGreaterThan(0);
    expect(rollback).toContain(legacy.slice(start, end).trimEnd());
  });
});

describe("saf fiyat hesabı (SQL plan_period_amount ile aynı kural)", () => {
  it("aylık dönemde tutar liste fiyatıdır", () => {
    for (const p of [...PLANS, BUSINESS_PLAN_TEMPLATE]) expect(planAmountOf(p, "monthly")).toBe(p.monthlyTry);
  });

  it("yıllık = aylık x ödenen ay (varsayılan 10), Math.round ile (SQL round)", () => {
    expect(DEFAULT_YEARLY_PAID_MONTHS).toBe(10);
    expect(planAmountTry("professional", "yearly")).toBe(4990 * 10);
    expect(planAmountOf({ monthlyTry: 2490, yearlyPaidMonths: 11 }, "yearly")).toBe(27390);
    expect(planAmountOf({ monthlyTry: 999.95, yearlyPaidMonths: 10 }, "yearly")).toBe(10000);
    expect(planAmountOf({ monthlyTry: 749 }, "yearly")).toBe(7490);
  });

  it("yıllık indirim eski %20 (x12x0.8) kuralı DEĞİLDİR", () => {
    for (const p of PLANS) {
      expect(planAmountOf(p, "yearly")).not.toBe(Math.round(p.monthlyTry * 12 * 0.8));
    }
  });
});
