import { renderTemplate } from "@/lib/email/templates";

/**
 * DUNNING politikası (SAF çekirdek + ayar okuyucu). Ayar tanımları `src/lib/settings/registry/dunning.ts`; düzenleme
 * `/admin/billing/tahsilat#ayarlar`. Tüketiciler: dunning cron'u (`/api/cron/dunning`) ve otomatik yenileme
 * (`src/lib/billing/auto-renew.ts`). Varsayılanlar bugünkü davranıştır (1/4/8 gün, yalnız uygulama içi, askı kapalı).
 */

export type DunningChannel = "in_app" | "email" | "sms";

export type DunningStage = {
  /** 1..3 (gün sırasına göre). `invoices.reminder_count` bu numarayı tutar. */
  stage: number;
  days: number;
  email: boolean;
  sms: boolean;
  /** Boş = yerleşik metin. */
  template: string;
};

export type DunningPolicy = {
  stages: DunningStage[];
  /** 0 = otomatik askı KAPALI (yalnız personele aday bildirimi; bugünkü davranış). */
  autoSuspendDays: number;
  /** Askıdan kaç gün önce son uyarı (0 = yok). Askı kapalıyken etkisiz. */
  finalWarningDays: number;
  autoRenewMaxAttempts: number;
  autoRenewRetryGapDays: number;
};

export const DUNNING_KEYS = [
  "dunning.stage1_days",
  "dunning.stage1_channels",
  "dunning.stage1_template",
  "dunning.stage2_days",
  "dunning.stage2_channels",
  "dunning.stage2_template",
  "dunning.stage3_days",
  "dunning.stage3_channels",
  "dunning.stage3_template",
  "dunning.auto_suspend_days",
  "dunning.final_warning_days",
  "dunning.auto_renew_max_attempts",
  "dunning.auto_renew_retry_gap_days",
] as const;

export const DEFAULT_DUNNING_POLICY: DunningPolicy = {
  stages: [
    { stage: 1, days: 1, email: false, sms: false, template: "" },
    { stage: 2, days: 4, email: false, sms: false, template: "" },
    { stage: 3, days: 8, email: false, sms: false, template: "" },
  ],
  autoSuspendDays: 0,
  finalWarningDays: 2,
  autoRenewMaxAttempts: 3,
  autoRenewRetryGapDays: 3,
};

export const BILLING_HREF = "/app/abonelik";
export const CARD_UPDATE_HREF = "/app/abonelik#kartlar";

function int(v: unknown, def: number, min: number, max: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : def;
}

/** Ayar değerlerinden politika (saf). Kademeler güne göre sıralanır; aynı gün tekrarı atılır. */
export function policyFromSettings(values: Record<string, unknown>): DunningPolicy {
  const d = DEFAULT_DUNNING_POLICY;
  const raw = [1, 2, 3].map((n) => {
    const ch = String(values[`dunning.stage${n}_channels`] ?? "in_app");
    return {
      days: int(values[`dunning.stage${n}_days`], d.stages[n - 1].days, 1, 90),
      email: ch.includes("email"),
      sms: ch.includes("sms"),
      template: String(values[`dunning.stage${n}_template`] ?? "").trim(),
    };
  });
  raw.sort((a, b) => a.days - b.days);
  const seen = new Set<number>();
  const stages: DunningStage[] = [];
  for (const r of raw) {
    if (seen.has(r.days)) continue;
    seen.add(r.days);
    stages.push({ stage: stages.length + 1, ...r });
  }
  return {
    stages,
    autoSuspendDays: int(values["dunning.auto_suspend_days"], d.autoSuspendDays, 0, 120),
    finalWarningDays: int(values["dunning.final_warning_days"], d.finalWarningDays, 0, 30),
    autoRenewMaxAttempts: int(values["dunning.auto_renew_max_attempts"], d.autoRenewMaxAttempts, 1, 10),
    autoRenewRetryGapDays: int(values["dunning.auto_renew_retry_gap_days"], d.autoRenewRetryGapDays, 1, 30),
  };
}

/** Ayarlar okunamazsa varsayılan (cron asla ayar yüzünden durmaz). */
export async function loadDunningPolicy(): Promise<DunningPolicy> {
  try {
    const { getSettings } = await import("@/lib/settings/read");
    return policyFromSettings(await getSettings(DUNNING_KEYS));
  } catch (e) {
    console.error("loadDunningPolicy", e instanceof Error ? e.message : "error");
    return DEFAULT_DUNNING_POLICY;
  }
}

/** Gecikme gününe göre ulaşılan en yüksek kademe (0 = henüz yok). */
export function stageOf(daysOverdue: number, stages: readonly DunningStage[]): DunningStage | null {
  let hit: DunningStage | null = null;
  for (const s of stages) if (daysOverdue >= s.days) hit = s;
  return hit;
}

/** Son uyarı günü (askı kapalıysa ya da uyarı 0 ise null). En erken 1. gün. */
export function finalWarningDay(policy: Pick<DunningPolicy, "autoSuspendDays" | "finalWarningDays">): number | null {
  if (policy.autoSuspendDays <= 0 || policy.finalWarningDays <= 0) return null;
  return Math.max(1, policy.autoSuspendDays - policy.finalWarningDays);
}

export type DunningMessageVars = { ofis: string; fatura: string; gun: number; odeme_linki: string; kart_linki: string };

/** Kademe mesajı: şablon doluysa o (değişkenler yerleştirilir), değilse yerleşik metin. Kart güncelleme bağlantısı eklenir. */
export function dunningMessage(
  stage: Pick<DunningStage, "stage" | "template">,
  lastStage: number,
  vars: DunningMessageVars,
): { title: string; body: string; kind: "warning" | "danger" } {
  const isLast = stage.stage >= lastStage;
  const title = isLast
    ? `Ödemeniz ${vars.gun} gündür gecikmiş — hesabınız askıya alınabilir`
    : stage.stage >= 2
      ? "Ödemeniz gecikti — lütfen en kısa sürede tamamlayın"
      : "Ödemeniz gecikti";
  const builtIn = isLast
    ? `${vars.fatura} numaralı faturanız ${vars.gun} gündür ödenmedi. Hizmet kesintisi yaşamamak için lütfen ödemenizi hemen tamamlayın.`
    : stage.stage >= 2
      ? `${vars.fatura} numaralı faturanızın vadesi ${vars.gun} gün önce doldu. Hizmet kesintisi yaşamamak için ödemenizi tamamlamanızı rica ederiz.`
      : `${vars.fatura} numaralı faturanızın vadesi geçti. Hizmet kesintisi yaşamamak için lütfen ödemenizi tamamlayın.`;
  let body = stage.template ? renderTemplate(stage.template, vars) : builtIn;
  if (!body.includes(vars.kart_linki)) body = `${body} Kartınızı güncellemek için: ${vars.kart_linki}`;
  return { title, body: body.slice(0, 1000), kind: isLast ? "danger" : "warning" };
}

export function finalWarningMessage(vars: DunningMessageVars, suspendDay: number) {
  const left = Math.max(0, suspendDay - vars.gun);
  return {
    title: "Son uyarı: hesabınız askıya alınmak üzere",
    body:
      `${vars.fatura} numaralı faturanız ${vars.gun} gündür ödenmedi. ${left > 0 ? `${left} gün içinde` : "Bugün"} ödeme alınmazsa ` +
      `hesabınız askıya alınacak. Ödeme: ${vars.odeme_linki} · Kart güncelleme: ${vars.kart_linki}`,
    kind: "danger" as const,
  };
}
