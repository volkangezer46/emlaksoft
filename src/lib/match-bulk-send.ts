/**
 * Eşleşmeyi toplu gönderme planı (SAF): tek portföyün eşleştiği alıcılara (ör. fiyat düşüşünde) aynı eşleşme mesajı.
 * Karar sırası alıcı başına: müşteri yok → aynı müşteri ikinci kez → daha önce gönderildi → iletişim engelli → örnek kayıt → geçerli cep telefonu yok
 * → İYS izni yok. Kalanlar sırayla, en fazla `MATCH_BULK_SEND_CAP` kişiye gönderilir; aşan kısım raporlanır (sessiz düşürme yok).
 *
 * İYS: toplu ileti ticari iletidir. Ofis ayarı "yalnız uyar" olsa bile toplu gönderimde izni eksik alıcı ATLANIR
 * (`strictIysAllowedIds`: kapının `warned` listesi de izinsiz sayılır).
 */
import type { IysGateResult } from "@/lib/iys/gate";
import { isValidTurkishMobile, normalizeTurkishPhone } from "@/lib/phone";

export const MATCH_BULK_SEND_CAP = 50;
/** İstemciden kabul edilen en fazla talep kimliği (eşleştirme ekranı en çok 80 talep tarar). */
export const MATCH_BULK_MAX_DEMANDS = 200;

export type MatchBulkRecipient = {
  demandId: string;
  customerId: string | null;
  fullName: string | null;
  phone: string | null;
  blacklist: boolean;
  isSample: boolean;
  /** Bu portföy bu talebe daha önce gönderildi (demand_property_matches, CRM-G4); varsayılan hariç tutulur. */
  alreadySent?: boolean;
};

export type MatchBulkSkipReason = "no_customer" | "duplicate" | "already_sent" | "blacklist" | "sample" | "no_phone" | "no_consent";

export const MATCH_BULK_SKIP_LABELS: Record<MatchBulkSkipReason, string> = {
  no_customer: "Müşteri kaydı yok",
  duplicate: "Aynı müşteri (tek mesaj gönderilir)",
  already_sent: "Daha önce gönderildi",
  blacklist: "İletişim engelli",
  sample: "Örnek kayıt",
  no_phone: "Geçerli cep telefonu yok",
  no_consent: "İYS izni yok",
};

export type MatchBulkPlan = {
  /** Bu turda gönderilecekler (tavan dahil). */
  send: MatchBulkRecipient[];
  /** Gönderilebilir ama tavan nedeniyle bu turda gönderilmeyecekler. */
  overCap: MatchBulkRecipient[];
  skipped: { recipient: MatchBulkRecipient; reason: MatchBulkSkipReason }[];
  counts: Record<MatchBulkSkipReason, number>;
};

/** Kapı sonucundan katı izinli küme: `allowed` içinden "yalnız uyar" modunda uyarılanlar çıkarılır. */
export function strictIysAllowedIds(result: Pick<IysGateResult, "allowed" | "warned">): Set<string> {
  const warned = new Set((result.warned ?? []).map((w) => w.customerId));
  return new Set(result.allowed.filter((id) => !warned.has(id)));
}

/** İYS sorgusundan önce: sözleşme dışı (engelli / örnek / telefonsuz / tekrar) alıcıları ayıklanmış müşteri kimlikleri. */
export function consentCandidateIds(recipients: readonly MatchBulkRecipient[]): string[] {
  return planMatchBulkSend(recipients, null).send.map((r) => r.customerId as string);
}

/**
 * `consentAllowed` null ise İYS adımı atlanır (aday listesi çıkarmak için). Aksi halde kümede olmayan müşteri `no_consent`.
 */
export function planMatchBulkSend(
  recipients: readonly MatchBulkRecipient[],
  consentAllowed: ReadonlySet<string> | null,
  cap: number = Number.POSITIVE_INFINITY,
): MatchBulkPlan {
  const counts: MatchBulkPlan["counts"] = { no_customer: 0, duplicate: 0, already_sent: 0, blacklist: 0, sample: 0, no_phone: 0, no_consent: 0 };
  const skipped: MatchBulkPlan["skipped"] = [];
  const eligible: MatchBulkRecipient[] = [];
  const seen = new Set<string>();
  const skip = (recipient: MatchBulkRecipient, reason: MatchBulkSkipReason) => {
    skipped.push({ recipient, reason });
    counts[reason] += 1;
  };
  for (const r of recipients) {
    if (!r.customerId) {
      skip(r, "no_customer");
      continue;
    }
    if (seen.has(r.customerId)) {
      skip(r, "duplicate");
      continue;
    }
    seen.add(r.customerId);
    if (r.alreadySent) skip(r, "already_sent");
    else if (r.blacklist) skip(r, "blacklist");
    else if (r.isSample) skip(r, "sample");
    else if (!r.phone || !isValidTurkishMobile(normalizeTurkishPhone(r.phone))) skip(r, "no_phone");
    else if (consentAllowed && !consentAllowed.has(r.customerId)) skip(r, "no_consent");
    else eligible.push(r);
  }
  const limit = Math.max(0, Math.floor(cap));
  return { send: eligible.slice(0, limit), overCap: eligible.slice(limit), skipped, counts };
}

/** Onay penceresi metni: gönderilecek / izni yok / diğer atlananlar. */
export function describeMatchBulkPlan(p: { send: number; overCap: number; counts: Record<MatchBulkSkipReason, number> }): string {
  const parts = [`Gönderilecek: ${p.send}`, `İzni yok: ${p.counts.no_consent}`];
  if (p.counts.already_sent) parts.push(`Daha önce gönderildi: ${p.counts.already_sent}`);
  if (p.counts.blacklist) parts.push(`İletişim engelli: ${p.counts.blacklist}`);
  if (p.counts.no_phone) parts.push(`Telefonu yok: ${p.counts.no_phone}`);
  if (p.counts.sample) parts.push(`Örnek kayıt: ${p.counts.sample}`);
  if (p.overCap) parts.push(`Tavan (${MATCH_BULK_SEND_CAP}) nedeniyle bu turda gönderilmeyecek: ${p.overCap}`);
  return parts.join(" · ");
}
