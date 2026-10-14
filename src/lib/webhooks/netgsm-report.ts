import type { MessageLogStatus } from "@/lib/messaging/message-log";

/**
 * Netgsm SMS İLETİM RAPORU (SAF, savunmacı). Netgsm panelindeki "rapor bildirim adresi" her mesaj için iş kimliği
 * (jobid/bulkid), numara ve durum kodu gönderir; alan adları sürüme göre değiştiği için birkaç eş ad kabul edilir.
 * Durum kodları (Netgsm rapor API'si): 0 iletilmeyi bekliyor, 1 iletildi, 2 zaman aşımı, 3 hatalı/kısıtlı numara,
 * 4 operatöre gönderilemedi, 11 operatör kabul etmedi, 12 gönderim hatası, 13 mükerrer gönderim, 103 başarısız görev.
 * Tanınmayan kod yok sayılır (durum değişmez).
 */

export type NetgsmReport = {
  jobId: string;
  /** Raporda numara varsa (günlükteki alıcı özetiyle karşılaştırılır). */
  phone: string | null;
  status: MessageLogStatus;
  code: string;
  error: string | null;
  /** Mesaj boyu (kredi) bildirildiyse. */
  segments: number | null;
  occurredAt: string | null;
};

const FAILED_REASON: Record<string, string> = {
  "2": "Zaman aşımı: mesaj geçerlilik süresinde iletilemedi.",
  "3": "Hatalı veya kısıtlı numara.",
  "4": "Operatöre gönderilemedi.",
  "11": "Operatör mesajı kabul etmedi.",
  "12": "Gönderim hatası.",
  "13": "Mükerrer gönderim.",
  "103": "Görev başarısız.",
};

function pick(f: Record<string, string>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = f[k]?.trim();
    if (v) return v;
  }
  return null;
}

/** Netgsm tarih biçimi "dd.MM.yyyy HH:mm:ss" (TR saati) ya da ISO. Tanınmazsa null (alıcı tarafı şimdiki zamanı yazar). */
export function parseNetgsmDate(raw: string | null): string | null {
  if (!raw) return null;
  const m = raw.match(/^(\d{2})[./](\d{2})[./](\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (m) {
    const iso = `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6] ?? "00"}+03:00`;
    return Number.isNaN(Date.parse(iso)) ? null : new Date(iso).toISOString();
  }
  return /^\d{4}-\d{2}-\d{2}T/.test(raw) && !Number.isNaN(Date.parse(raw)) ? new Date(raw).toISOString() : null;
}

/** Tek rapor satırı (alan adları küçük harfe çevrilmiş). Kimlik/durum yoksa ya da kod tanınmıyorsa null. */
export function parseNetgsmReport(fields: Record<string, string>): NetgsmReport | null {
  const jobId = pick(fields, "jobid", "bulkid", "job_id", "msgid", "messageid");
  const code = pick(fields, "status", "durum", "state");
  if (!jobId || !/^[\x21-\x7e]{1,128}$/.test(jobId) || !code || !/^\d{1,3}$/.test(code)) return null;
  let status: MessageLogStatus | null = null;
  if (code === "0") status = "queued";
  else if (code === "1") status = "delivered";
  else if (FAILED_REASON[code]) status = "failed";
  if (!status) return null;
  const errCode = pick(fields, "errorcode", "error_code", "hata");
  const phone = pick(fields, "telno", "gsmno", "gsm", "no", "msisdn", "phone");
  const len = Number(pick(fields, "msglen", "boy", "credit") ?? "");
  return {
    jobId,
    phone: phone && /^[+\d\s()-]{8,20}$/.test(phone) ? phone : null,
    status,
    code: status === "failed" && errCode && /^[\w-]{1,32}$/.test(errCode) ? `netgsm_${code}_${errCode}` : `netgsm_${code}`,
    error: status === "failed" ? (FAILED_REASON[code] ?? null) : null,
    segments: Number.isInteger(len) && len > 0 && len <= 100 ? len : null,
    occurredAt: parseNetgsmDate(pick(fields, "delivereddate", "deliverydate", "date", "tarih")),
  };
}

const MAX_REPORTS = 200;

function lowerScalars(o: unknown): Record<string, string> | null {
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    if (typeof v === "string" || typeof v === "number") out[k.toLowerCase()] = String(v);
  }
  return out;
}

/**
 * JSON gövdeyi rapor alan kümelerine açar: tek nesne, dizi ya da `{ reports|data|items: [...] }`. En çok 200 satır.
 */
export function netgsmReportFieldSets(json: unknown): Record<string, string>[] {
  const list = Array.isArray(json)
    ? json
    : json && typeof json === "object"
      ? (["reports", "data", "items"].map((k) => (json as Record<string, unknown>)[k]).find(Array.isArray) as unknown[] | undefined) ?? [json]
      : [];
  return list
    .slice(0, MAX_REPORTS)
    .map(lowerScalars)
    .filter((x): x is Record<string, string> => x !== null);
}
