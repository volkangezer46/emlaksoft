/**
 * EİDS e-postası UYGULAMA POLİTİKASI — SAF. Sahip kararı (2026-10-13, ayarla değiştirilebilir):
 *  - Doğrulanmış (verified / verified_via_arc) + taşınmaz no tek portföyle BİREBİR eşleşmiş (tür de tutuyor) +
 *    elle yapıştırılmamış + ayar açık → otomatik uygula (applyAuthorityEvent; geri alınabilir).
 *  - Doğrulanamayan, yapıştırılan, ayar kapalı → 'queued' (kontrol bekliyor; owner/gm/branch_manager onaylar).
 *  - Birden çok portföy ya da tür uyuşmazlığı → 'candidate' (insan seçer). Hiç portföy yok → 'no_match'.
 * Kalıba uymayan biçim bu fonksiyona gelmez (unknown_format; uygulanacak bir olay yok).
 */
import { isVerifiedAuth, type MailAuthResult } from "./mail-auth";
import type { EidsDealKind } from "./mail-parse";

export type InboundVia = "smtp" | "eml_upload" | "paste" | "resend";
export type MatchStatus = "applied" | "queued" | "candidate" | "no_match" | "duplicate" | "dismissed" | "rejected";

export type PropertyMatchRow = { id: string; transaction_type: string | null };

export type MatchOutcome =
  | { kind: "exact"; propertyId: string }
  | { kind: "candidate"; propertyIds: string[] }
  | { kind: "none" };

/** Portföy işlem türü → EİDS türü (Satılık/Kiralık; bilinmiyorsa null). */
export function dealKindOfTransaction(t: string | null | undefined): EidsDealKind | null {
  const v = String(t ?? "").toLocaleLowerCase("tr-TR");
  if (v.startsWith("sat") || v === "sale") return "sale";
  if (v.startsWith("kir") || v === "rent") return "rent";
  return null;
}

/** Aynı taşınmaz no'lu portföylerden e-postadaki türe göre birebir eşleşme. */
export function matchProperties(rows: readonly PropertyMatchRow[], dealKind: EidsDealKind): MatchOutcome {
  if (rows.length === 0) return { kind: "none" };
  const same = rows.filter((r) => dealKindOfTransaction(r.transaction_type) === dealKind);
  if (same.length === 1) return { kind: "exact", propertyId: same[0]!.id };
  // Tür tutmuyor ya da birden çok aday: insan seçer (en çok 5).
  return { kind: "candidate", propertyIds: (same.length > 1 ? same : rows).slice(0, 5).map((r) => r.id) };
}

export type InboundDecision = { action: "apply"; propertyId: string } | { action: "queue"; status: Exclude<MatchStatus, "applied" | "duplicate" | "dismissed" | "rejected"> };

export function decideInbound(input: { auth: MailAuthResult; via: InboundVia; match: MatchOutcome; autoApply: boolean }): InboundDecision {
  if (input.match.kind === "none") return { action: "queue", status: "no_match" };
  if (input.match.kind === "candidate") return { action: "queue", status: "candidate" };
  if (input.via === "paste" || !isVerifiedAuth(input.auth) || !input.autoApply) return { action: "queue", status: "queued" };
  return { action: "apply", propertyId: input.match.propertyId };
}

/** Anlamsal tekrar penceresi (gün): aynı ofis + no + tür + bitiş tarihi bu süre içinde yeniden gelirse yeni olay açılmaz. */
export const SEMANTIC_DUP_DAYS = 7;
/** Ham .eml saklama süresi (gün; KVKK). */
export const RAW_RETENTION_DAYS = 30;
/** İletme onay kodu kartta kalma süresi (saat). */
export const CONFIRM_TTL_HOURS = 24;
/** Mesaj başına üst sınır (SMTP alıcısı ile aynı). */
export const MAX_MAIL_BYTES = 256 * 1024;
/** Yapıştırılan metin üst sınırı (karakter). */
export const MAX_PASTE_CHARS = 20_000;

/** İlan Kontrol > Yetki içindeki e-posta sekmesi (kontrol bekliyor + "Bakanlık e-postası ekle"). */
export const EIDS_INBOX_HREF = "/app/ilan-kontrol/yetki?sekme=eposta";

/** Onaylayabilen roller (kontrol bekliyor kuyruğu). */
export const EIDS_REVIEW_ROLES = ["owner", "gm", "branch_manager"] as const;
/** Adresi oluşturabilen / yenileyebilen roller. */
export const EIDS_ADDRESS_ROLES = ["owner", "gm"] as const;

export const MATCH_STATUS_LABELS: Record<MatchStatus, string> = {
  applied: "Uygulandı",
  queued: "Kontrol bekliyor",
  candidate: "Portföy seçilmeli",
  no_match: "Eşleşen portföy yok",
  duplicate: "Tekrar",
  dismissed: "Yok sayıldı",
  rejected: "Reddedildi",
};
