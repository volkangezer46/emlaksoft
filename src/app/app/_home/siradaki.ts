/**
 * "Sıradaki en iyi eylem" — saf karar mantığı (DB'ye ve React'e bağımlı değil; vitest kapsamında).
 *
 * Öncelik sırası (tek kaynak): bugünkü randevu → gecikmiş görev → dönüş bekleyen sıcak müşteri →
 * yetki belgesi bitişi → 7+ gün teyitsiz ilan → bekleyen komisyon → kurulumun eksik adımı →
 * hiçbiri yoksa "Müşteri ekle". Yalnız GERÇEK sayı > 0 olan adım aday olur (sahte vaat yok).
 */

export type NextActionTone = "brand" | "danger" | "warn" | "success";

export type NextAction = {
  key: string;
  /** Büyük düğmenin etiketi. */
  label: string;
  /** Kartın başlığı (tek cümle). */
  title: string;
  /** Neden şimdi — gerçek sayıdan türeyen açıklama. */
  reason: string;
  href: string;
  tone: NextActionTone;
};

export type NextActionInput = {
  appointmentsToday: number;
  firstAppointment: { time: string; type: string } | null;
  tasksOverdue: number;
  hotLeads: number;
  expiringAuthority: number;
  unconfirmedListings: number;
  /** Yalnız kullanıcı kendi (ya da earnings_all ile ofis) komisyonunu görebiliyorsa > 0 verilir. */
  pendingCommissionText: string | null;
  onboardingNext: { title: string; href: string } | null;
};

export const FALLBACK_ACTION_KEY = "musteri-ekle";

export const FALLBACK_ACTION: NextAction = {
  key: FALLBACK_ACTION_KEY,
  label: "Müşteri ekle",
  title: "Bugün için bekleyen iş görünmüyor",
  reason: "Yeni bir müşteri eklemek hattı canlı tutar.",
  href: "/app/hizli?sekme=musteri",
  tone: "brand",
};

/** Aday eylemler öncelik sırasıyla; her zaman son eleman sönmez yedek eylemdir. */
export function buildNextActions(i: NextActionInput): NextAction[] {
  const out: NextAction[] = [];
  if (i.appointmentsToday > 0) {
    const first = i.firstAppointment;
    out.push({
      key: "randevu",
      label: "Randevulara git",
      title: i.appointmentsToday === 1 ? "Bugün 1 randevun var" : `Bugün ${i.appointmentsToday} randevun var`,
      reason: first ? `İlki ${first.time} · ${first.type}` : "Hazırlığını yap, müşteriyi önceden teyit et.",
      href: "/app/randevular",
      tone: "brand",
    });
  }
  if (i.tasksOverdue > 0) {
    out.push({
      key: "gorev",
      label: "Gecikenleri aç",
      title: `${i.tasksOverdue} görevin gecikmiş`,
      reason: "Önce bunları kapat; geciken iş müşteriye geç dönüş demektir.",
      href: "/app/gorevler?filter=overdue&mine=1",
      tone: "danger",
    });
  }
  if (i.hotLeads > 0) {
    out.push({
      key: "sicak",
      label: "Müşterileri ara",
      title: `${i.hotLeads} sıcak müşteri dönüş bekliyor`,
      reason: "Sıcak müşteri beklemez; bugün bir arama dönüşümü belirler.",
      href: "/app/musteriler?sort=hot",
      tone: "success",
    });
  }
  if (i.expiringAuthority > 0) {
    out.push({
      key: "yetki",
      label: "Portföyleri gör",
      title: `${i.expiringAuthority} portföyün yetkisi 15 gün içinde doluyor`,
      reason: "Yetki yenilenmezse portföy elden çıkabilir.",
      href: "/app/portfoyler",
      tone: "warn",
    });
  }
  if (i.unconfirmedListings > 0) {
    out.push({
      key: "teyit",
      label: "İlanları teyit et",
      title: `${i.unconfirmedListings} ilan 7+ gündür teyitsiz`,
      reason: "Portallarda yayında görünmeyen ilan müşteri kaçırır.",
      href: "/app/portallar?durum=teyit",
      tone: "warn",
    });
  }
  if (i.pendingCommissionText) {
    out.push({
      key: "komisyon",
      label: "Komisyonu aç",
      title: `${i.pendingCommissionText} komisyon tahsilat bekliyor`,
      reason: "Tahsilat takibi yapılmayan komisyon gecikir.",
      href: "/app/komisyon?durum=bekleyen",
      tone: "warn",
    });
  }
  if (i.onboardingNext) {
    out.push({
      key: "kurulum",
      label: "Adımı tamamla",
      title: `Kurulumun sıradaki adımı: ${i.onboardingNext.title}`,
      reason: "Kurulum tamamlandıkça ekran sana daha doğru işler önerir.",
      href: i.onboardingNext.href,
      tone: "brand",
    });
  }
  out.push(FALLBACK_ACTION);
  return out;
}

/** "Bugün için geç" ile atlananlar dışındaki ilk eylem; yedek eylem hiç atlanamaz. */
export function pickNextAction(actions: readonly NextAction[], dismissed: readonly string[]): NextAction {
  const skip = new Set(dismissed);
  return actions.find((a) => a.key === FALLBACK_ACTION_KEY || !skip.has(a.key)) ?? FALLBACK_ACTION;
}

export const SKIP_COOKIE = "es_eylem_gec";

/** Çerez değeri `GÜN|anahtar,anahtar`; gün bugünkü değilse (eski çerez) boş liste. */
export function parseSkipCookie(value: string | undefined, todayKey: string): string[] {
  if (!value) return [];
  const [day, keys] = value.split("|");
  if (day !== todayKey || !keys) return [];
  return keys.split(",").filter((k) => /^[a-z-]{1,24}$/.test(k));
}

export function serializeSkipCookie(todayKey: string, keys: readonly string[]): string {
  return `${todayKey}|${[...new Set(keys)].join(",")}`;
}
