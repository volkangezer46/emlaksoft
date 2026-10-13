import { portalDisplayName, portalIdFromName } from "./catalog";

/**
 * PORTAL TEYİT PLANI (SAF, testli; `portal-teyit` cron'u kullanır). Üç kural (EP1):
 *  1) Üyeliği "none" olan portaldaki canlı ilan için teyit/kontrol işi AÇILMAZ; yerine ilan başına TEK SEFERLİK
 *     "üyelik dışı portalda canlı ilan" uyarısı çıkar (dedupe_key ilanın kimliğiyle, kova yok).
 *  2) Ofiste eklenti (verification_clients) varsa gecikmiş ilan başına günlük uyarı sürer (cron 24 saat kovasıyla tekilleştirir).
 *  3) Ofiste eklenti YOKSA ilan başına günlük uyarı gönderilmez; haftalık TEK "otomatik kontrol yok, elle teyit edin" özeti gider.
 * `tenantsWithExtension = null` (tablo okunamadı) → eski davranış: herkes ilan başına günlük.
 */

export type TeyitListing = { id: string; tenant_id: string; portal_name: string | null; portal_listing_id: string | null };

export type TeyitPlan = {
  daily: TeyitListing[];
  weekly: { tenantId: string; count: number }[];
  outOfMembership: TeyitListing[];
  /** Üyelik dışı olduğu için teyit uyarısından çıkarılan gecikmiş ilan sayısı. */
  skippedNonMember: number;
};

export const WEEK_MS = 7 * 86_400_000;

/** Ofis → üyeliği "none" olan portal kimlikleri. */
export type NonePortals = ReadonlyMap<string, ReadonlySet<string>>;

export function isNonMemberListing(l: Pick<TeyitListing, "tenant_id" | "portal_name">, none: NonePortals): boolean {
  const id = portalIdFromName(l.portal_name);
  return !!id && (none.get(l.tenant_id)?.has(id) ?? false);
}

export function planPortalTeyit(input: {
  overdue: readonly TeyitListing[];
  /** Üyeliği "none" portaldaki BÜTÜN canlı ilanlar (gecikmiş olsun olmasın). */
  nonMemberLive: readonly TeyitListing[];
  nonePortals: NonePortals;
  tenantsWithExtension: ReadonlySet<string> | null;
}): TeyitPlan {
  const daily: TeyitListing[] = [];
  const weeklyCounts = new Map<string, number>();
  let skippedNonMember = 0;
  for (const l of input.overdue) {
    if (isNonMemberListing(l, input.nonePortals)) {
      skippedNonMember += 1;
      continue;
    }
    if (input.tenantsWithExtension === null || input.tenantsWithExtension.has(l.tenant_id)) daily.push(l);
    else weeklyCounts.set(l.tenant_id, (weeklyCounts.get(l.tenant_id) ?? 0) + 1);
  }
  const seen = new Set<string>();
  const outOfMembership = input.nonMemberLive.filter((l) => isNonMemberListing(l, input.nonePortals) && !seen.has(l.id) && (seen.add(l.id), true));
  return {
    daily,
    weekly: [...weeklyCounts].map(([tenantId, count]) => ({ tenantId, count })),
    outOfMembership,
    skippedNonMember,
  };
}

/** Bildirim metinleri (tek yer). */
export function outOfMembershipText(l: TeyitListing): { title: string; body: string } {
  const name = portalDisplayName(l.portal_name);
  return {
    title: "Üyelik dışı portalda canlı ilan",
    body: `${name}${l.portal_listing_id ? ` #${l.portal_listing_id}` : ""}: ofis bu portala "üye değil" olarak işaretli ama ilan EmlakSoft'ta canlı görünüyor. İlan yayından kalktıysa kaydı kapatın; üyelik sürüyorsa Portal üyelikleri kartını düzeltin.`,
  };
}

export function weeklySummaryText(count: number): { title: string; body: string } {
  return {
    title: "Otomatik kontrol yok: ilanları elle teyit edin",
    body: `${count} canlı portal ilanı 7+ gündür teyit edilmedi. Ofiste İlan Kontrol eklentisi bağlı olmadığı için otomatik kontrol yapılamıyor; ilanları portalda açıp elle teyit edin ya da eklentiyi kurun.`,
  };
}
