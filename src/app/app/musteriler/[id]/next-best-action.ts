/**
 * Sonraki en iyi eylem — SAF kural motoru (AI yok, şema değişikliği yok, uydurma sayı yok).
 * Müşteri 360'ın zaten okuduğu veriler + akışla gelen sinyallerden (gerçek eşleşme sayısı, sunum/portal ilgisi)
 * EN ÇOK İKİ öneri üretir; her önerinin bir "neden" satırı ve gerçek bir eylemi vardır. Hiçbir kural tutmazsa
 * boş dizi döner ve kart "Şu an için önerilen bir eylem yok" der.
 *
 * Kural önceliği (ilk iki eşleşen gösterilir):
 * a) Yeni başvuru: kayıt ≤ 48 saat, hiç temas yok → "İlk aramayı yapın" (hızlı dönüş; Ara + WhatsApp)
 * b) Dijital ilgi: son 24 saatte sunum açıldı ya da portalda bekleyen arayış isteği var → "İlgisi sıcak: şimdi ulaşın"
 * c) Sıcak müşteri 14+ gündür temassız → "Şimdi arayın"
 * d) Açık talebe uyan GERÇEK portföy var (skor ≥ 35, elenmeyen) → "N uygun portföyü inceleyin"
 * e) Sunulan teklif yanıt bekliyor → "Teklifi takip edin"
 * f) Tarihi geçmiş randevunun sonucu girilmemiş → "Sonucu kaydedin"
 * g) Açık talep 45+ gün önce açıldı → "Talep hâlâ geçerli mi, sorun" (WhatsApp taslağı)
 * h) Doğum günü / yıldönümü 3 gün içinde → "Tebrik edin"
 *
 * İletişim tercihi (CRM-G11): WhatsApp tercih eden müşteride arama önerilerinin birincil düğmesi WhatsApp olur;
 * uygun saat penceresi dışındaysa öneriye "Uygun saat: …" notu eklenir.
 */

import { DAY_MS } from "@/lib/clock";
import { contactWindowNote, type ContactPrefs } from "@/lib/customer-contact-prefs";

const HOUR_MS = 3_600_000;
export const NEW_LEAD_HOURS = 48;
export const CONTACT_GAP_DAYS = 14;
export const STALE_DEMAND_DAYS = 45;
export const OCCASION_DAYS = 3;
export const MAX_ACTIONS = 2;

export type NbaLink = {
  label: string;
  href: string;
  /** tel:, wa.me, mailto: → <a>; iç bağlantı → <Link>. */
  external?: boolean;
  kind: "call" | "whatsapp" | "mail" | "link";
};

export type NextBestAction = {
  key: "first_contact" | "digital_interest" | "call" | "match" | "offer" | "appointment" | "stale_demand" | "occasion";
  title: string;
  /** "Neden" satırı — yalnız gerçek veriden. */
  reason: string;
  primary: NbaLink;
  secondary?: NbaLink;
  /** Uygun saat penceresi dışındaysa uyarı. */
  timingNote?: string | null;
};

export type NbaSignals = {
  /** Gerçek eşleşme sayısı (skor ≥ 35, elenmeyen); null = hesaplanmadı (yetki yok / akış bekleniyor). */
  matchCount: number | null;
  /** Aday havuzu sınırı aşıldı: sayı alt sınırdır ("200+"). */
  matchTruncated?: boolean;
  /** Son görüntülenen sunumun zamanı (ISO), yoksa null. */
  presentationViewedAt: string | null;
  presentationTitle?: string | null;
  /** Portalda bekleyen arayış güncelleme isteği sayısı. */
  pendingPortalRequests: number;
};

export type NextBestActionInput = {
  customerId: string;
  firstName: string;
  leadTier: "hot" | "warm" | "cold";
  leadLabel: string;
  telHref: string | null;
  /** wa.me bağlantısı (selamlama mesajsız); telefon geçersizse null. */
  waHref: string | null;
  /** Hazır mesajlı wa.me bağlantısı üretici (talep teyidi / tebrik). */
  waMessageHref?: (message: string) => string | null;
  email: string | null;
  /** En son çağrı/randevu/iletişim (ISO); hiç yoksa null. */
  lastActivityAt: string | null;
  createdAt: string;
  /** Herhangi bir çağrı, iletişim kaydı ya da randevu var mı? */
  hasAnyContact: boolean;
  openDemands: { id: string; created_at: string; label: string }[];
  canMatch: boolean;
  submittedOfferId: string | null;
  pastAppointmentPending: boolean;
  birthDate: string | null;
  anniversaryDate: string | null;
  prefs: ContactPrefs | null;
  signals: NbaSignals;
  nowMs: number;
};

function elapsed(iso: string | null, nowMs: number): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : nowMs - t;
}

function relHours(ms: number): string {
  const h = Math.max(0, Math.floor(ms / HOUR_MS));
  if (h < 1) return "1 saatten kısa süre önce";
  if (h < 24) return `${h} saat önce`;
  return `${Math.floor(h / 24)} gün önce`;
}

/** Ay-gün yıldönümüne kalan gün (0 = bugün), İstanbul takvimi; geçersiz tarihte null. */
export function daysUntilAnnual(dateIso: string | null, nowMs: number): number | null {
  if (!dateIso || !/^\d{4}-\d{2}-\d{2}/.test(dateIso)) return null;
  const [, mm, dd] = dateIso.slice(0, 10).split("-").map(Number);
  const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date(nowMs));
  const [ty, tm, td] = todayStr.split("-").map(Number);
  const today = Date.UTC(ty, tm - 1, td);
  let next = Date.UTC(ty, mm - 1, dd);
  if (next < today) next = Date.UTC(ty + 1, mm - 1, dd);
  return Math.round((next - today) / DAY_MS);
}

/** Arama önerisinin düğmeleri: tercih WhatsApp ise WhatsApp önde. */
function reachLinks(input: NextBestActionInput, callLabel: string): { primary: NbaLink; secondary?: NbaLink } | null {
  const call: NbaLink | null = input.telHref ? { label: callLabel, href: input.telHref, external: true, kind: "call" } : null;
  const wa: NbaLink | null = input.waHref ? { label: "WhatsApp", href: input.waHref, external: true, kind: "whatsapp" } : null;
  const mail: NbaLink | null = input.email ? { label: "E-posta yazın", href: `mailto:${input.email}`, external: true, kind: "mail" } : null;
  const channel = input.prefs?.channel ?? null;
  if (channel === "whatsapp" && wa) return { primary: { ...wa, label: "WhatsApp'tan yazın" }, secondary: call ?? undefined };
  if (channel === "email" && mail) return { primary: mail, secondary: call ?? wa ?? undefined };
  if (call) return { primary: call, secondary: wa ?? undefined };
  if (wa) return { primary: wa };
  if (mail) return { primary: mail };
  return null;
}

export function computeNextBestActions(input: NextBestActionInput): NextBestAction[] {
  const out: NextBestAction[] = [];
  const timing = contactWindowNote(input.prefs?.windows ?? [], input.nowMs);
  const push = (a: NextBestAction) => {
    if (out.length < MAX_ACTIONS && !out.some((x) => x.key === a.key)) out.push(a);
  };
  const age = elapsed(input.createdAt, input.nowMs);
  const sinceContact = elapsed(input.lastActivityAt ?? input.createdAt, input.nowMs);

  // a) Yeni başvuru — hiç temas yok
  if (!input.hasAnyContact && age !== null && age >= 0 && age <= NEW_LEAD_HOURS * HOUR_MS) {
    const links = reachLinks(input, "Şimdi arayın");
    if (links) {
      push({
        key: "first_contact",
        title: "Yeni başvuru: ilk teması kurun",
        reason: `Kayıt ${relHours(age)} açıldı, henüz arama ya da mesaj yok. Hızlı dönüş başvuruyu sıcak tutar.`,
        ...links,
        timingNote: timing,
      });
    }
  }

  // b) Dijital ilgi — son 24 saatte sunum açıldı / portalda bekleyen istek
  const viewedAgo = elapsed(input.signals.presentationViewedAt, input.nowMs);
  if (viewedAgo !== null && viewedAgo >= 0 && viewedAgo <= DAY_MS) {
    const links = reachLinks(input, "Şimdi arayın");
    if (links) {
      push({
        key: "digital_interest",
        title: "İlgisi sıcak: şimdi ulaşın",
        reason: `${input.signals.presentationTitle ? `"${input.signals.presentationTitle}" sunumunu` : "Gönderdiğiniz sunumu"} ${relHours(viewedAgo)} açtı.`,
        ...links,
        timingNote: timing,
      });
    }
  } else if (input.signals.pendingPortalRequests > 0) {
    push({
      key: "digital_interest",
      title: "Portaldan arayış güncellemesi bekliyor",
      reason: `Müşteri portaldan ${input.signals.pendingPortalRequests} güncelleme isteği gönderdi; onaylanınca talep güncellenir.`,
      primary: { label: "İsteği inceleyin", href: `/app/musteriler/${input.customerId}?sekme=ozet#portal-istekleri`, kind: "link" },
    });
  }

  // c) Sıcak müşteri soğumasın
  if (input.leadTier === "hot" && sinceContact !== null && sinceContact >= CONTACT_GAP_DAYS * DAY_MS) {
    const links = reachLinks(input, "Şimdi arayın");
    if (links) {
      push({
        key: "call",
        title: "Sıcak müşteri soğumak üzere",
        reason: `${Math.floor(sinceContact / DAY_MS)} gündür temas yok · durum: ${input.leadLabel.toLocaleLowerCase("tr-TR")}`,
        ...links,
        timingNote: timing,
      });
    }
  }

  // d) Gerçek eşleşme
  const matchCount = input.signals.matchCount;
  if (input.canMatch && input.openDemands.length > 0 && matchCount !== null && matchCount > 0) {
    push({
      key: "match",
      title: `${matchCount}${input.signals.matchTruncated ? "+" : ""} uygun portföy var`,
      reason: `${input.openDemands.length} açık talebe uyan portföy (eşleşme puanı 35 ve üstü). Uygun olanları seçip gönderin.`,
      primary: { label: "Eşleşmeleri inceleyin", href: `/app/talepler?sekme=eslesme&customer=${input.customerId}`, kind: "link" },
    });
  }

  // e) Teklif yanıt bekliyor
  if (input.submittedOfferId) {
    push({
      key: "offer",
      title: "Teklif yanıt bekliyor",
      reason: "Sunulan teklif henüz yanıtlanmadı; nazik bir hatırlatma zamanı.",
      primary: { label: "Teklifi takip edin", href: `/app/teklifler/${input.submittedOfferId}`, kind: "link" },
    });
  }

  // f) Randevu sonucu eksik
  if (input.pastAppointmentPending) {
    push({
      key: "appointment",
      title: "Randevu sonucu eksik",
      reason: "Tarihi geçmiş randevu tamamlandı ya da iptal olarak işaretlenmedi.",
      primary: { label: "Sonucu kaydedin", href: `/app/randevular?customer=${input.customerId}`, kind: "link" },
    });
  }

  // g) Bayatlamış talep
  const stale = input.openDemands
    .map((d) => ({ d, ms: elapsed(d.created_at, input.nowMs) }))
    .filter((x): x is { d: (typeof input.openDemands)[number]; ms: number } => x.ms !== null && x.ms >= STALE_DEMAND_DAYS * DAY_MS)
    .sort((a, b) => b.ms - a.ms)[0];
  if (stale) {
    const msg = `Merhaba ${input.firstName}, ${stale.d.label ? `${stale.d.label} arayışınız` : "arayışınız"} hâlâ devam ediyor mu? Kriterlerinizde bir değişiklik varsa güncelleyelim.`;
    const wa = input.waMessageHref?.(msg) ?? null;
    push({
      key: "stale_demand",
      title: "Talep hâlâ geçerli mi, sorun",
      reason: `Açık talep ${Math.floor(stale.ms / DAY_MS)} gün önce açıldı; kriterler değişmiş olabilir.`,
      primary: wa
        ? { label: "WhatsApp ile sorun", href: wa, external: true, kind: "whatsapp" }
        : { label: "Talebi gözden geçirin", href: `/app/musteriler/${input.customerId}?sekme=talepler`, kind: "link" },
      timingNote: wa ? timing : null,
    });
  }

  // h) Doğum günü / yıldönümü
  const occasions = [
    { days: daysUntilAnnual(input.birthDate, input.nowMs), what: "Doğum günü", msg: "doğum gününüzü kutlar, sağlıklı ve mutlu bir yıl dileriz" },
    { days: daysUntilAnnual(input.anniversaryDate, input.nowMs), what: "Yıldönümü", msg: "yıldönümünüzü kutlarız" },
  ].filter((o): o is { days: number; what: string; msg: string } => o.days !== null && o.days <= OCCASION_DAYS)
    .sort((a, b) => a.days - b.days)[0];
  if (occasions) {
    const wa = input.waMessageHref?.(`Merhaba ${input.firstName}, ${occasions.msg}.`) ?? null;
    push({
      key: "occasion",
      title: `${occasions.what} ${occasions.days === 0 ? "bugün" : `${occasions.days} gün sonra`}`,
      reason: "Kısa bir tebrik ilişkiyi sıcak tutar.",
      primary: wa
        ? { label: "WhatsApp ile tebrik edin", href: wa, external: true, kind: "whatsapp" }
        : input.telHref
          ? { label: "Arayın", href: input.telHref, external: true, kind: "call" }
          : { label: "Kartı açın", href: `/app/musteriler/${input.customerId}?sekme=ozet`, kind: "link" },
    });
  }

  return out;
}
