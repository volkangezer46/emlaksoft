import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getSettingDef } from "@/lib/settings/registry";

const root = process.cwd();
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

/** Sözleşme: oransal yükseltme / planlı düşürme / duraklatma — bayrak + yetki + denetim olmadan para ya da abonelik değişmez. */
describe("bayraklar (Ayar Kayıt Defteri): VARSAYILAN KAPALI", () => {
  it("üç ayar tanımlı, platform kapsamlı ve güvenli varsayılanlı", () => {
    for (const key of ["billing.plan_change_proration_enabled", "billing.pause_enabled"]) {
      const d = getSettingDef(key)!;
      expect(d, key).toBeTruthy();
      expect(d.default, key).toBe(false);
      expect(d.codec.parse(null), key).toBe(false);
      expect(d.codec.parse("on"), key).toBe(true);
      expect(d.codec.format(true), key).toBe("on"); // SQL billing_setting_on 'on' kabul eder
      expect(d.risk, key).toBe("high");
    }
    const max = getSettingDef("billing.pause_max_days")!;
    expect(max.default).toBe(30);
    expect(max.codec.parse("0")).toBe(30);
    expect(max.codec.parse("91")).toBe(30);
    expect(max.codec.parse("45")).toBe(45);
  });
});

describe("plan-change action'ları", () => {
  const src = read("src/app/actions/plan-change.ts");
  const upgrade = src.slice(src.indexOf("export async function startPlanUpgrade"), src.indexOf("export async function scheduleDowngrade"));
  const schedule = src.slice(src.indexOf("export async function scheduleDowngrade"), src.indexOf("export async function cancelScheduledDowngrade"));
  const cancel = src.slice(src.indexOf("export async function cancelScheduledDowngrade"));

  it("her action requirePermission('billing','edit') ile başlar, destek oturumunu ve owner/gm dışını reddeder", () => {
    for (const body of [upgrade, schedule, cancel]) {
      expect(body.indexOf('requirePermission("billing", "edit")')).toBeGreaterThan(0);
      expect(body).toContain("gate.impersonating");
      expect(body).toContain("CHANGE_ROLES.includes(gate.role)");
    }
  });

  it("yükseltme: sıra = izin, rol, hız sınırı, bayrak, hazırlık, iyzico, hesap, kapasite, onay, fatura, ödeme; tutar istemciden alınmaz", () => {
    const order = [
      'requirePermission("billing", "edit")',
      "CHANGE_ROLES.includes(gate.role)",
      "checkRateLimit(`planupg:",
      "isPlanChangeEnabled()",
      "support.upgradeReady",
      "isIyzicoConfigured()",
      "evaluatePlanChange(",
      "assertBillingPlanPreflight(",
      "Math.abs(confirmTry - ev.chargeNetTry)",
      "createCheckoutInvoice(",
      "logActivity(",
      "initializeCheckoutForm(",
    ].map((needle) => upgrade.indexOf(needle));
    expect(order.every((i) => i > 0), JSON.stringify(order)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(upgrade).not.toMatch(/formData\.get\("(amount|price|total|charge)/);
    expect(upgrade).not.toContain("fulfillSuccessfulPayment"); // demo ödeme yolu YOK
    expect(upgrade).toContain('kind: "plan_upgrade"');
    expect(upgrade).toContain("amountTry: ev.chargeNetTry"); // fatura net tutarı sunucu hesabı (KDV createCheckoutInvoice/invoiceAmountsTry)
    expect(upgrade).toContain("fromPlan: state.planId");
  });

  it("yükseltme: duraklatılmış / aktif olmayan abonelikte ve iyi tanımlı olmayan durumda para tahsil edilmez", () => {
    expect(upgrade).toContain("state.pause.paused");
    expect(upgrade).toContain('state.status !== "active"');
    expect(upgrade).toContain('if (ev.status !== "upgrade") return { error: ev.message }');
  });

  it("düşürme: bayrak + hazırlık + kapasite ön denetimi, RPC ile planlanır (iade/ödeme yok)", () => {
    for (const needle of ["isPlanChangeEnabled()", "pauseReady", 'ev.status !== "downgrade"', "assertBillingPlanPreflight(", 'rpc("subscription_schedule_downgrade"']) {
      expect(schedule, needle).toContain(needle);
    }
    expect(schedule).not.toContain("initializeCheckoutForm");
    expect(schedule).not.toContain("createCheckoutInvoice");
  });

  it("yeni createAdminClient kullanımı açılmaz; zaman yardımcıları kullanılır", () => {
    for (const f of ["src/app/actions/plan-change.ts", "src/app/actions/subscription-pause.ts", "src/lib/billing/plan-change.ts", "src/lib/billing/pause-guard.ts", "src/lib/billing/subscription-lifecycle.ts"]) {
      const code = read(f);
      expect(code, f).not.toContain("createAdminClient");
      expect(code, f).not.toMatch(/Date\.now\(|new Date\(\)/);
    }
  });

  it("tam fiyatlı paket değişimi: bayrak açıkken startPlanCheckout yükseltmeyi/düşürmeyi kendi yoluna yönlendirir", () => {
    const billing = read("src/app/actions/billing.ts");
    const start = billing.slice(billing.indexOf("export async function startPlanCheckout"), billing.indexOf("export type SeatPurchaseResult"));
    expect(start).toContain("changeState?.pause.paused");
    expect(start).toContain("(await getPlanSupport()).upgradeReady");
    expect(start).toContain('change.status === "upgrade"');
    expect(start).toContain('change.status === "downgrade"');
    // Bayrak kapalı / şema yok iken eski akış AYNEN: yönlendirme yalnız bu iki koşul açıkken.
    expect(start).toMatch(/isIyzicoConfigured\(\) && \(await isPlanChangeEnabled\(\)\)/);
    const seat = billing.slice(billing.indexOf("export async function startSeatPurchase"), billing.indexOf("export type CreditPackPurchaseResult"));
    expect(seat).toContain("loadPlanChangeState(supabase, gate.tenantId))?.pause.paused");
  });
});

describe("subscription-pause action'ları", () => {
  const src = read("src/app/actions/subscription-pause.ts");
  const pause = src.slice(src.indexOf("export async function pauseSubscription"), src.indexOf("export async function resumeSubscription"));
  const resume = src.slice(src.indexOf("export async function resumeSubscription"));

  it("yetki: billing/edit; duraklatma yalnız OWNER, devam owner/gm; destek oturumu reddedilir", () => {
    expect(pause).toContain('requirePermission("billing", "edit")');
    expect(pause).toContain('gate.role !== "owner"');
    expect(pause).toContain("gate.impersonating");
    expect(resume).toContain('requirePermission("billing", "edit")');
    expect(resume).toContain('gate.role !== "owner" && gate.role !== "gm"');
    expect(resume).toContain("gate.impersonating");
  });

  it("duraklatma: hız sınırı, bayrak, hazırlık, ön denetim, sonra RPC; devam bayraktan bağımsız", () => {
    const order = ["checkRateLimit(`pause:", "isPauseEnabled()", "support.pauseReady", "evaluatePause(", 'rpc("subscription_pause"'].map((n) => pause.indexOf(n));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(resume).not.toContain("isPauseEnabled");
    expect(resume).toContain('rpc("subscription_resume")');
  });

  it("yazma tek yerde: RPC (denetim SQL'de aynı işlemde); doğrudan tablo yazımı yok", () => {
    expect(src).not.toMatch(/\.from\("subscriptions"\)\s*\.(update|insert|upsert|delete)/);
  });
});

describe("salt-okunur kapı ve cron", () => {
  it("requirePermission duraklatma kapısını modül kapısından sonra çağırır", () => {
    const rp = read("src/lib/require-permission.ts");
    expect(rp.indexOf("moduleActionBlock(")).toBeGreaterThan(0);
    expect(rp.indexOf("pausedWriteBlock(")).toBeGreaterThan(rp.indexOf("moduleActionBlock("));
  });

  it("abonelik-kontrol: yaşam döngüsü adımı iptal adımından ÖNCE, iptal adımı duraklatılmışları atlar; yeni cron YOK", () => {
    const route = read("src/app/api/cron/abonelik-kontrol/route.ts");
    expect(route.indexOf("runSubscriptionLifecycle(admin)")).toBeGreaterThan(0);
    expect(route.indexOf("runSubscriptionLifecycle(admin)")).toBeLessThan(route.indexOf('.eq("cancel_at_period_end", true)'));
    expect(route).toContain("pausedSubscriptionIds(admin");
    expect(route).toContain("!pausedDue.has(String(s.id))");
    const vercel = JSON.parse(read("vercel.json")) as { crons: { path: string }[] };
    expect(vercel.crons.filter((c) => c.path.includes("abonelik-kontrol"))).toHaveLength(1);
    expect(vercel.crons).toHaveLength(36);
  });

  it("plan-support: pauseReady/upgradeReady probe'ları (şema yokken özellik gizli)", () => {
    const ps = read("src/lib/billing/plan-support.ts");
    expect(ps).toContain('admin.rpc("subscription_pause_ready")');
    expect(ps).toContain('admin.rpc("plan_upgrade_ready")');
    expect(ps).toContain("out.upgradeReady = out.pauseReady &&");
  });

  it("istemci panelleri sunucu modülü / zaman import etmez", () => {
    for (const f of ["src/app/app/abonelik/plan-change-cell.tsx", "src/app/app/abonelik/pause-panel.tsx"]) {
      const code = read(f);
      expect(code.startsWith('"use client";'), f).toBe(true);
      expect(code, f).not.toMatch(/from "@\/lib\/supabase\//);
      expect(code, f).not.toMatch(/from "@\/lib\/billing\/(plan-change|plan-support|pause-guard)"/);
      expect(code, f).not.toMatch(/Date\.now\(|new Date\(/);
    }
  });
});
