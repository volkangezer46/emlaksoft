/**
 * PA-9 talep birleştirme — saf yardımcılar (RPC yükü ve hata eşlemesi; testli). RPC: `support_merge_tickets`
 * (migration 20261019070001). Aday listesi kuralı: aynı ofis, kendisi değil, kapalı değil, birleşmemiş.
 */

export type MergePayload = {
  sourceId: string;
  sourceNo: string | null;
  targetId: string;
  targetNo: string | null;
  tenantId: string;
  createdBy: string | null;
  subject: string;
};

export function parseMergePayload(data: unknown): MergePayload | null {
  if (!data || typeof data !== "object") return null;
  const r = data as Record<string, unknown>;
  if (r.ok !== true || typeof r.sourceId !== "string" || typeof r.targetId !== "string" || typeof r.tenantId !== "string") return null;
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  return {
    sourceId: r.sourceId,
    sourceNo: str(r.sourceNo),
    targetId: r.targetId,
    targetNo: str(r.targetNo),
    tenantId: r.tenantId,
    createdBy: str(r.createdBy),
    subject: typeof r.subject === "string" ? r.subject : "",
  };
}

const MESSAGES: [RegExp, string][] = [
  [/MERGE_SAME/, "Talep kendisiyle birleştirilemez."],
  [/MERGE_TENANT/, "Yalnız aynı ofisin talepleri birleştirilebilir."],
  [/MERGE_ALREADY/, "Bu talep zaten başka bir talebe birleştirilmiş."],
  [/MERGE_TARGET_MERGED/, "Seçilen talep başka bir talebe birleştirilmiş; o talebi seçin."],
  [/MERGE_TARGET_CLOSED/, "Kapalı talebe birleştirilemez; önce talebi yeniden açın ya da başka talep seçin."],
  [/Ticket not found/, "Talep bulunamadı."],
  [/Invalid support actor/, "Bu işlem için destek personeli yetkisi gerekir."],
  [/PGRST202|42883|Could not find the function|support_merge_tickets.*does not exist/i, "Talep birleştirme bu ortamda henüz etkin değil (veritabanı güncellemesi bekleniyor)."],
];

/** Bilinen RPC hatasını Türkçe mesaja çevirir; bilinmiyorsa null. */
export function mergeErrorMessage(error: { code?: string; message?: string } | null | undefined): string | null {
  if (!error) return null;
  const text = `${error.code ?? ""} ${error.message ?? ""}`;
  for (const [re, msg] of MESSAGES) if (re.test(text)) return msg;
  return null;
}

export type MergeCandidateRow = { id: string; ticket_no: string | null; subject: string; status: string; merged_into_id?: string | null };

/** Aday süzgeci (sunucu sorgusu kolonsuz da çalışsın diye birleşmiş satırlar burada da elenir). */
export function mergeCandidates(rows: readonly MergeCandidateRow[], selfId: string): MergeCandidateRow[] {
  return rows.filter((r) => r.id !== selfId && r.status !== "closed" && !r.merged_into_id);
}
