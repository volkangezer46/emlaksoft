/**
 * Takip dizileri (drip / Action Plan, COM-05) — SAF kurallar (testli). Sunucu: sequences.ts (durdurma),
 * sequence-runner.ts (cron), eylemler: src/app/actions/sequences.ts. Tablo: 20261018070001_message_sequences.sql.
 */

export const SEQUENCE_STEP_TYPES = ["sms", "whatsapp_template", "email", "task"] as const;
export type SequenceStepType = (typeof SEQUENCE_STEP_TYPES)[number];

export const SEQUENCE_STEP_LABELS: Record<SequenceStepType, string> = {
  sms: "SMS",
  whatsapp_template: "WhatsApp şablonu",
  email: "E-posta",
  task: "Arama/takip görevi",
};

export const MAX_SEQUENCE_STEPS = 10;
export const MAX_ENROLL_BATCH = 500;

export const ENROLLMENT_STATUS_LABELS: Record<string, string> = {
  active: "Devam ediyor",
  completed: "Tamamlandı",
  stopped: "Durduruldu",
};

export const STOP_REASON_LABELS: Record<string, string> = {
  reply: "Müşteri yanıt verdi",
  manual: "Elle durduruldu",
  sequence_inactive: "Dizi kapatıldı",
  customer_removed: "Müşteri silindi ya da kara listede",
  completed: "Tüm adımlar bitti",
  deal_closed: "Anlaşma kapandı (kazanıldı ya da kaybedildi)",
};

export type SequenceStepDraft = {
  step_type: SequenceStepType;
  delay_days: number;
  config: Record<string, unknown>;
};

const TEMPLATE_NAME_RE = /^[a-z0-9_]{1,512}$/;
const TEMPLATE_LANGUAGE_RE = /^[a-z]{2,3}(?:_[A-Z]{2})?$/;

function text(v: unknown, max: number): string {
  return String(v ?? "").trim().slice(0, max);
}

/**
 * Formdan gelen adım listesini doğrular ve yalnız beyaz listedeki alanları bırakır. İlk hata Türkçe döner.
 */
export function parseSequenceSteps(raw: unknown): { ok: true; steps: SequenceStepDraft[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: "Adımlar okunamadı." };
  if (raw.length === 0) return { ok: false, error: "En az bir adım ekleyin." };
  if (raw.length > MAX_SEQUENCE_STEPS) return { ok: false, error: `Bir dizide en çok ${MAX_SEQUENCE_STEPS} adım olabilir.` };
  const steps: SequenceStepDraft[] = [];
  for (const [i, item] of raw.entries()) {
    const n = i + 1;
    if (!item || typeof item !== "object") return { ok: false, error: `${n}. adım okunamadı.` };
    const s = item as Record<string, unknown>;
    const type = String(s.step_type ?? "") as SequenceStepType;
    if (!SEQUENCE_STEP_TYPES.includes(type)) return { ok: false, error: `${n}. adımın türü geçersiz.` };
    const delay = Number(s.delay_days);
    if (!Number.isInteger(delay) || delay < 0 || delay > 365) return { ok: false, error: `${n}. adımın gecikmesi 0-365 gün olmalı.` };
    const src = (s.config && typeof s.config === "object" ? s.config : {}) as Record<string, unknown>;
    const config: Record<string, unknown> = {};
    switch (type) {
      case "sms": {
        const t = text(src.text, 500);
        if (!t) return { ok: false, error: `${n}. adım: SMS metni zorunlu.` };
        config.text = t;
        break;
      }
      case "whatsapp_template": {
        const name = text(src.template_name, 512);
        const language = text(src.language, 6);
        if (!TEMPLATE_NAME_RE.test(name) || !TEMPLATE_LANGUAGE_RE.test(language)) {
          return { ok: false, error: `${n}. adım: onaylı WhatsApp şablon adı ve dili gerekli (ör. portfoy_duyurusu · tr).` };
        }
        config.template_name = name;
        config.language = language;
        const param = text(src.body_param, 200);
        if (param) config.body_param = param;
        break;
      }
      case "email": {
        const subject = text(src.subject, 200);
        const body = text(src.body, 4000);
        if (!subject || !body) return { ok: false, error: `${n}. adım: e-posta konusu ve metni zorunlu.` };
        config.subject = subject;
        config.body = body;
        break;
      }
      case "task": {
        const title = text(src.title, 200);
        if (!title) return { ok: false, error: `${n}. adım: görev başlığı zorunlu.` };
        config.title = title;
        const priority = String(src.priority ?? "normal");
        config.priority = ["low", "normal", "high"].includes(priority) ? priority : "normal";
        break;
      }
    }
    steps.push({ step_type: type, delay_days: delay, config });
  }
  return { ok: true, steps };
}

/** Adımı otomasyon motorunun eylem uygulayıcısına (executeSequenceAction) verilecek eyleme çevirir. */
export function stepToAction(step: { step_type: string; config: Record<string, unknown> }): { type: string; config: Record<string, unknown> } | null {
  const c = step.config ?? {};
  switch (step.step_type) {
    case "sms":
      return { type: "send_sms", config: { template: String(c.text ?? "") } };
    case "whatsapp_template":
      return { type: "send_whatsapp", config: { template_name: c.template_name, language: c.language, body_param: c.body_param ?? "" } };
    case "email":
      return { type: "send_email", config: { subject: c.subject, body: c.body } };
    case "task":
      return { type: "create_task", config: { title: c.title, priority: c.priority ?? "normal", due_days: 1 } };
    default:
      return null;
  }
}

/** Adım gecikmelerinden toplam gün ("Gün N" rozeti): [0, 1, 2] → [0, 1, 3]. Geçersiz/negatif gecikme 0 sayılır. */
export function cumulativeDays(delays: readonly unknown[]): number[] {
  const out: number[] = [];
  let total = 0;
  for (const raw of delays) {
    const d = Number(raw);
    total += Number.isFinite(d) && d > 0 ? Math.round(d) : 0;
    out.push(total);
  }
  return out;
}

const DAY_MS = 86_400_000;

/** Adım çalıştıktan (ya da kayıttan) sonra bir sonraki adımın vadesi: şimdi + o adımın gecikmesi. */
export function nextDueAt(fromMs: number, delayDays: number): string {
  return new Date(fromMs + Math.max(0, Math.round(delayDays)) * DAY_MS).toISOString();
}

/**
 * Sessiz saat: mesaj adımları yalnız TR saatiyle 09:00-20:00 arasında gönderilir (Türkiye UTC+3, yaz saati yok).
 * Dışarıda kalan adım bir sonraki çalıştırmaya kalır (kaybolmaz).
 */
export function inSequenceSendWindow(nowMs: number): boolean {
  const trHour = (new Date(nowMs).getUTCHours() + 3) % 24;
  return trHour >= 9 && trHour < 20;
}

/** Bugünün (TR) başlangıcı, ISO — günlük tavan sayımı için. */
export function trDayStartIso(nowMs: number): string {
  const shifted = new Date(nowMs + 3 * 3_600_000);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - 3 * 3_600_000).toISOString();
}

/** Önceki adım sahiplenilmiş ama bitmemişse (çöken çalıştırma) ne kadar sonra "bitti" sayılıp ilerlenir. */
export const STALE_CLAIM_MS = 15 * 60_000;

/**
 * Aynı adım için daha önce sahiplenme satırı varsa ne yapılır: sonuçlanmışsa ya da eski sahiplenmeyse ilerle
 * (YENİDEN GÖNDERME YOK), tazeyse başka çalıştırma işliyor demektir: bekle.
 */
export function decideExistingClaim(row: { result: string; created_at: string } | null, nowMs: number): "advance" | "wait" {
  if (!row) return "wait";
  if (row.result !== "claimed") return "advance";
  const at = Date.parse(row.created_at);
  return Number.isFinite(at) && nowMs - at > STALE_CLAIM_MS ? "advance" : "wait";
}
