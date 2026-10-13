import { TICKET_PRIORITIES, type TicketPriority } from "@/lib/support/ticket-contract";

/**
 * Destek SLA politikası (SAF): öncelik × plan matrisi, iş dakikası. DB tablosu `support_sla_policies`
 * (plan='*' tüm planların varsayılanı; plana özel satır onu ezer). Hesap kuralı DB'de `support_sla_minutes`.
 */

export const SLA_PLAN_KEYS = ["*", "advisor", "office", "professional", "business", "enterprise"] as const;
export type SlaPlanKey = (typeof SLA_PLAN_KEYS)[number];

export const SLA_PLAN_LABEL: Record<SlaPlanKey, string> = {
  "*": "Tüm planlar (varsayılan)",
  advisor: "Danışman",
  office: "Ofis",
  professional: "Profesyonel",
  business: "Business",
  enterprise: "Kurumsal",
};

export const SLA_PRIORITY_LABEL: Record<TicketPriority, string> = {
  urgent: "Acil",
  high: "Yüksek",
  normal: "Normal",
  low: "Düşük",
};

export type SlaKind = "first_response" | "resolution";
export type SlaTarget = { firstResponseMinutes: number; resolutionMinutes: number };
export type SlaPolicyRow = { plan: string; priority: string; first_response_minutes: number; resolution_minutes: number };

/** Migration seed'i ile aynı: ilk yanıt 8 iş saati / çözüm 3 iş günü (9 saatlik gün) normal öncelikte. */
export const DEFAULT_SLA_POLICY: Record<TicketPriority, SlaTarget> = {
  urgent: { firstResponseMinutes: 60, resolutionMinutes: 480 },
  high: { firstResponseMinutes: 240, resolutionMinutes: 1080 },
  normal: { firstResponseMinutes: 480, resolutionMinutes: 1620 },
  low: { firstResponseMinutes: 960, resolutionMinutes: 2700 },
};

export const SLA_LIMITS = {
  firstResponseMin: 15,
  firstResponseMax: 43_200,
  resolutionMin: 30,
  resolutionMax: 129_600,
} as const;

export function isSlaPlanKey(value: string): value is SlaPlanKey {
  return (SLA_PLAN_KEYS as readonly string[]).includes(value);
}

/** Plan + öncelik için hedef (plana özel > '*' > kod varsayılanı) — DB `support_sla_minutes` ile aynı. */
export function resolveSlaTarget(rows: readonly SlaPolicyRow[], plan: string, priority: TicketPriority): SlaTarget {
  const own = rows.find((r) => r.plan === plan && r.priority === priority);
  const fallback = rows.find((r) => r.plan === "*" && r.priority === priority);
  const row = own ?? fallback;
  return row
    ? { firstResponseMinutes: row.first_response_minutes, resolutionMinutes: row.resolution_minutes }
    : DEFAULT_SLA_POLICY[priority];
}

/** Ekranda saat cinsinden giriş: "2" veya "1,5" → dakika. Boş = null (plana özel satır yok). */
export function parseHoursInput(raw: string): number | null | "invalid" {
  const v = raw.trim().replace(",", ".");
  if (!v) return null;
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(v)) return "invalid";
  return Math.round(Number(v) * 60);
}

export function formatHours(minutes: number): string {
  const hours = minutes / 60;
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(2).replace(/0$/, "").replace(".", ",");
}

export type SlaMatrixEntry = { plan: SlaPlanKey; priority: TicketPriority; firstResponseMinutes: number; resolutionMinutes: number };

/**
 * Formdaki matrisi ayrıştırır: alanlar `fr:<plan>:<öncelik>` ve `rs:<plan>:<öncelik>` (saat).
 * '*' satırlarının hepsi zorunlu; plana özel satır ya iki alanı birden taşır ya hiç (boş = varsayılanı kullan).
 */
export function parseSlaMatrixForm(get: (name: string) => string): { entries: SlaMatrixEntry[]; error?: string } {
  const entries: SlaMatrixEntry[] = [];
  for (const plan of SLA_PLAN_KEYS) {
    for (const priority of TICKET_PRIORITIES) {
      const fr = parseHoursInput(get(`fr:${plan}:${priority}`));
      const rs = parseHoursInput(get(`rs:${plan}:${priority}`));
      const label = `${SLA_PLAN_LABEL[plan]} · ${SLA_PRIORITY_LABEL[priority]}`;
      if (fr === "invalid" || rs === "invalid") return { entries: [], error: `${label}: süreyi saat olarak girin (ör. 2 veya 1,5).` };
      if (fr === null && rs === null) {
        if (plan === "*") return { entries: [], error: `${label}: varsayılan satır boş bırakılamaz.` };
        continue;
      }
      if (fr === null || rs === null) return { entries: [], error: `${label}: ilk yanıt ve çözüm süresini birlikte girin ya da ikisini de boş bırakın.` };
      if (fr < SLA_LIMITS.firstResponseMin || fr > SLA_LIMITS.firstResponseMax) {
        return { entries: [], error: `${label}: ilk yanıt 0,25-720 iş saati arasında olmalı.` };
      }
      if (rs < SLA_LIMITS.resolutionMin || rs > SLA_LIMITS.resolutionMax) {
        return { entries: [], error: `${label}: çözüm 0,5-2160 iş saati arasında olmalı.` };
      }
      if (rs < fr) return { entries: [], error: `${label}: çözüm süresi ilk yanıt süresinden kısa olamaz.` };
      entries.push({ plan, priority, firstResponseMinutes: fr, resolutionMinutes: rs });
    }
  }
  return { entries };
}
