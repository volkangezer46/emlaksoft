import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { bodyMd5FromFile, extractFunctionBodies } from "@/lib/migration-rehearsal/core";

/**
 * SÖZLEŞME: 20261007001010 (plan_upgrade faturası) fulfill/v2 gövdeleri 20260826000300 gövdelerinin BAYT BAYT kopyasıdır;
 * yalnız `plan-upgrade:v1` işaretli bloklar eklenmiştir. 20261007001000 RPC'leri JWT kimlikli, bayrak/sınır SQL'de de denetlenir.
 * Saf dosya taraması (DB yok); işlevsel doğrulama plan-change-sql-exec.test.ts (pglite).
 */
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");
const PACK = read("supabase/migrations/20260826000300_ef_credit_pack_fulfillment.sql");
const UP = read("supabase/migrations/20261007001010_plan_upgrade_fulfillment.sql");
const UP_RB = read("supabase/rollbacks/20261007001010_plan_upgrade_fulfillment.rollback.sql");
const PAUSE = read("supabase/migrations/20261007001000_subscription_pause_and_plan_change.sql");
const PAUSE_RB = read("supabase/rollbacks/20261007001000_subscription_pause_and_plan_change.rollback.sql");

const stripUpgradeBlocks = (s: string) =>
  s
    .replace(/^[ \t]*-- plan-upgrade:v1 >>>[\s\S]*?^[ \t]*-- plan-upgrade:v1 <<<\n/gm, "");

function bodyOf(sql: string, name: string): string {
  const all = extractFunctionBodies(sql).filter((b) => b.name === name);
  expect(all, name).toHaveLength(1);
  return all[0]!.body;
}

describe("plan_upgrade fulfill (20261007001010): taban 20260826000300 bayt bayt korunur", () => {
  it("plan-upgrade:v1 blokları çıkarılınca gövdeler 20260826000300 ile AYNI (md5)", () => {
    for (const fn of ["fulfill_billing_payment", "fulfill_billing_payment_v2"]) {
      expect(bodyMd5FromFile(stripUpgradeBlocks(UP), fn), fn).toBe(bodyMd5FromFile(PACK, fn));
    }
    expect(bodyMd5FromFile(PACK, "fulfill_billing_payment")).toBe("48be5cd7f2f755c860d326209f52c9a3");
    expect(bodyMd5FromFile(PACK, "fulfill_billing_payment_v2")).toBe("47f246dea3152903ef17edd8cd08f95d");
  });

  it("başlıktaki BEKLENEN SONRA md5'leri gövdelerle eşleşir; ön koşul taban md5'lerini arar", () => {
    const f10 = bodyMd5FromFile(UP, "fulfill_billing_payment")!;
    const v2 = bodyMd5FromFile(UP, "fulfill_billing_payment_v2")!;
    expect(UP).toContain(`fulfill_billing_payment (10 arg)  ${f10}`);
    expect(UP).toContain(`fulfill_billing_payment_v2        ${v2}`);
    expect(UP).toContain("<> '48be5cd7f2f755c860d326209f52c9a3' then");
    expect(UP).toContain("<> '47f246dea3152903ef17edd8cd08f95d' then");
    // Canlı gövde yamalanmaz: yorum satırı dışında pg_get_functiondef kullanımı yok.
    expect(UP.split("\n").filter((l) => !/^\s*--/.test(l) && /pg_get_functiondef/.test(l))).toEqual([]);
  });

  it("işaretler: plan-upgrade:v1 eklendi, credit-pack:v1 ve seat-fulfillment:v1 korundu; bilinmeyen tür reddi yerinde", () => {
    for (const fn of ["fulfill_billing_payment", "fulfill_billing_payment_v2"]) {
      const b = bodyOf(UP, fn);
      expect(b, fn).toContain("plan-upgrade:v1");
      expect(b, fn).toContain("credit-pack:v1");
      expect(b, fn).toContain("seat-fulfillment:v1");
    }
    const f10 = bodyOf(UP, "fulfill_billing_payment");
    expect(f10).toContain("if v_kind is not null and v_kind <> 'extra_seats' then");
    // Tür bloğu, bilinmeyen-tür reddinden ÖNCE döner (credit_pack ile aynı kalıp).
    expect(f10.indexOf("if v_kind = 'plan_upgrade' then")).toBeGreaterThan(0);
    expect(f10.indexOf("if v_kind = 'plan_upgrade' then")).toBeLessThan(f10.indexOf("if v_kind is not null and v_kind <> 'extra_seats' then"));
    expect(bodyOf(UP, "fulfill_billing_payment_v2")).toMatch(/if v_result ->> 'kind' = 'plan_upgrade' then[\s\S]*?checkout_status = 'fulfilled'[\s\S]*?return v_result;/);
  });

  it("v2 plan_upgrade'de dönemi UZATMAZ (dönem uzatan kod bloğundan önce döner)", () => {
    const v2 = bodyOf(UP, "fulfill_billing_payment_v2");
    expect(v2.indexOf("'plan_upgrade'")).toBeLessThan(v2.indexOf("v_period_end := case"));
  });

  it("plan_upgrade bloğu güvenlik kapıları: tutar faturadan, katalog tavanı, plan/durum/duraklatma/dönem kontrolü, tek sefer, denetim", () => {
    const f10 = bodyOf(UP, "fulfill_billing_payment");
    const start = f10.indexOf("if v_kind = 'plan_upgrade' then");
    const end = f10.indexOf("-- plan-upgrade:v1 <<<", start);
    const block = f10.slice(start, end);
    for (const needle of [
      "abs(v_total_try - p_expected_amount_try) > 0.01",
      "public.plan_period_amount(v_plan, v_cycle)",
      "v_up_charge_net > v_up_period_full + 0.01",
      "for update;",
      "v_up_sub_plan is distinct from v_up_from_plan",
      "v_up_sub_status is distinct from 'active'",
      "v_up_sub_paused is not null",
      "v_up_sub_period_end <= v_now",
      "v_up_new_monthly <= v_up_old_monthly",
      "if v_invoice_status = 'paid' then",
      "billing.plan_upgraded",
    ]) {
      expect(block, needle).toContain(needle);
    }
    // Dönem ve döngü DEĞİŞMEZ: abonelik güncellemesi current_period_* / billing_cycle yazmaz.
    const upd = block.slice(block.indexOf("update public.subscriptions s"), block.indexOf("returning s.id into v_up_updated_sub_id"));
    expect(upd).not.toMatch(/current_period_(start|end)\s*=/);
    expect(upd).not.toMatch(/billing_cycle\s*=/);
    expect(upd).toContain("plan = v_plan");
    expect(upd).toContain("pending_plan = null");
  });

  it("plan_upgrade_ready() yalnız service_role; gövde işaretlerini yoklar; yetkiler kısıtlı", () => {
    const ready = bodyOf(UP, "plan_upgrade_ready");
    expect(ready).toContain("auth.role() is distinct from 'service_role'");
    expect(ready.match(/plan-upgrade:v1/g)?.length).toBeGreaterThanOrEqual(2);
    expect(UP).toContain("revoke all privileges on function public.plan_upgrade_ready() from public, anon, authenticated, service_role;");
    expect(UP).toContain("grant execute on function public.plan_upgrade_ready() to service_role;");
    expect(UP).toMatch(/revoke all privileges on function public\.fulfill_billing_payment\([\s\S]*?from public, anon, authenticated, service_role;/);
  });

  it("rollback 20260826000300 gövdelerine birebir döner ve hazırlık yoklamasını düşürür", () => {
    for (const fn of ["fulfill_billing_payment", "fulfill_billing_payment_v2"]) {
      expect(bodyMd5FromFile(UP_RB, fn), fn).toBe(bodyMd5FromFile(PACK, fn));
    }
    expect(UP_RB).toContain("drop function if exists public.plan_upgrade_ready();");
    expect(UP_RB).not.toContain("plan-upgrade:v1 >>>");
  });
});

describe("duraklatma + planlı düşürme RPC'leri (20261007001000)", () => {
  it("kullanıcı RPC'leri JWT kimlikli: kimlik auth.uid(), ofis current_tenant_id(); parametreyle kimlik verilmez", () => {
    for (const fn of ["subscription_pause", "subscription_resume", "subscription_schedule_downgrade", "subscription_cancel_scheduled_downgrade"]) {
      const b = bodyOf(PAUSE, fn);
      expect(b, fn).toContain("v_uid uuid := auth.uid()");
      expect(b, fn).toContain("v_tenant uuid := public.current_tenant_id()");
      expect(b, fn).toContain("impersonating");
      expect(b, fn).toContain("audit_logs");
      expect(b, fn).toContain("for update");
    }
    expect(PAUSE).not.toMatch(/function public\.subscription_(pause|resume|schedule_downgrade|cancel_scheduled_downgrade)\([^)]*(tenant|actor|user)/i);
  });

  it("bayraklar ve sınırlar SQL'de de denetlenir (dogrudan RPC çağrısı bypass edemez)", () => {
    const pause = bodyOf(PAUSE, "subscription_pause");
    expect(pause).toContain("billing_setting_on('billing.pause_enabled')");
    expect(pause).toContain("billing_setting_int('billing.pause_max_days', 30, 1, 90)");
    expect(pause).toContain("interval '365 days'");
    expect(pause).toContain("p.role = 'owner'");
    const down = bodyOf(PAUSE, "subscription_schedule_downgrade");
    expect(down).toContain("billing_setting_on('billing.plan_change_proration_enabled')");
    expect(down).toContain("v_new_amount >= v_cur_amount");
  });

  it("platform askısı anlamındaki status='paused' DEĞİŞTİRİLMEZ; eski taslak sütunları kullanılmaz", () => {
    const code = PAUSE.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
    expect(code).not.toMatch(/status\s*=\s*'paused'/);
    expect(code).not.toMatch(/\bpaused_at\b|\bpause_resume_at\b|\bpause_remaining\b/);
  });

  it("cron RPC'leri yalnız service_role, bayraktan bağımsız; kullanıcı RPC'leri yalnız authenticated", () => {
    expect(bodyOf(PAUSE, "subscription_resume_due")).toContain("auth.role() is distinct from 'service_role'");
    expect(bodyOf(PAUSE, "subscription_apply_scheduled_plan_changes")).toContain("auth.role() is distinct from 'service_role'");
    expect(bodyOf(PAUSE, "subscription_resume_due")).not.toContain("billing_setting_on");
    expect(bodyOf(PAUSE, "subscription_apply_scheduled_plan_changes")).not.toContain("billing_setting_on");
    expect(PAUSE).toContain("grant execute on function public.subscription_pause(integer) to authenticated;");
    expect(PAUSE).toContain("grant execute on function public.subscription_resume_due() to service_role;");
    expect(PAUSE).toContain("grant execute on function public.billing_setting_on(text) to service_role;");
    expect(PAUSE).not.toMatch(/grant execute on function public\.billing_setting_(on|int)[^;]*authenticated/);
  });

  it("ön koşul bloğu ve rollback", () => {
    expect(PAUSE).toContain("plan_monthly_amount/plan_campaign_lock_amount yok");
    for (const needle of [
      "drop function if exists public.subscription_pause(integer);",
      "drop column if exists pause_started_at",
      "drop column if exists pending_plan,",
    ]) {
      expect(PAUSE_RB, needle).toContain(needle);
    }
  });
});
