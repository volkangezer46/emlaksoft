/**
 * Yetki belgesi (emlak ofisi) yardımcıları — saf, sunucu/istemci güvenli.
 *
 * Dayanak notu: Taşınmaz Ticareti Hakkında Yönetmelik m.14/2-i uyarınca ilan
 * ve reklamlarda yetki belgesi numarası ile işletme unvanı/iletişim bilgisinin yer alması beklenir.
 * Madde numarası ve kapsam bu belgede resmi metinden DOĞRULANAMADI; bkz. docs/MEVZUAT_SABITLERI.md.
 */

export const LICENSE_NO_MAX = 60;
export const LICENSE_TITLE_MAX = 200;

/** Yaklaşan süre eşikleri (gün): 60 / 30 / 7. */
export const LICENSE_EXPIRY_THRESHOLDS = [60, 30, 7] as const;

type Norm = { ok: true; value: string | null } | { ok: false; error: string };

/**
 * Esnek yetki belgesi no: boşluk, harf, rakam ve . - / _ kabul edilir; baştaki/sondaki boşluk atılır, ardışık
 * boşluklar teke iner. Resmi biçim doğrulanamadığı için katı desen UYGULANMAZ; yalnız anlamsız/uzun girdi reddedilir.
 */
export function normalizeLicenseNo(raw: unknown): Norm {
  const s = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!s) return { ok: true, value: null };
  if (s.length > LICENSE_NO_MAX) return { ok: false, error: `Yetki belgesi no en çok ${LICENSE_NO_MAX} karakter olabilir.` };
  if (!/^[\p{L}\p{N} ./\-_]+$/u.test(s)) {
    return { ok: false, error: "Yetki belgesi no yalnız harf, rakam, boşluk, nokta, tire ve eğik çizgi içerebilir." };
  }
  if (!/[\p{L}\p{N}]/u.test(s)) return { ok: false, error: "Yetki belgesi no en az bir harf veya rakam içermeli." };
  return { ok: true, value: s };
}

export function normalizeLicenseTitle(raw: unknown): Norm {
  const s = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!s) return { ok: true, value: null };
  if (s.length > LICENSE_TITLE_MAX) return { ok: false, error: `Belge unvanı en çok ${LICENSE_TITLE_MAX} karakter olabilir.` };
  return { ok: true, value: s };
}

/** "YYYY-MM-DD" geçerlilik tarihi; boş = null; gerçek takvim tarihi değilse hata. */
export function normalizeLicenseValidUntil(raw: unknown): Norm {
  const s = String(raw ?? "").trim();
  if (!s) return { ok: true, value: null };
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return { ok: false, error: "Geçerlilik tarihi tarih seçiciyle girilmeli." };
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(Date.UTC(y, mo - 1, day));
  if (d.getUTCFullYear() !== y || d.getUTCMonth() !== mo - 1 || d.getUTCDate() !== day) {
    return { ok: false, error: "Geçerlilik tarihi geçerli bir takvim günü değil." };
  }
  if (y < 2000 || y > 2100) return { ok: false, error: "Geçerlilik yılı 2000-2100 arasında olmalı." };
  return { ok: true, value: s };
}

export type LicenseState = "missing" | "no_date" | "valid" | "expiring" | "expired";

export type LicenseStatus = {
  state: LicenseState;
  /** Bitişe kalan gün (geçmişse negatif). Tarih yoksa null. */
  daysLeft: number | null;
  /** 60/30/7 eşiklerinden ulaşılan en dar eşik (yalnız expiring). */
  threshold: 60 | 30 | 7 | null;
  tone: "danger" | "warning" | "ok" | "neutral";
  label: string;
};

/** İki "YYYY-MM-DD" günü arasındaki gün farkı (to - from). */
export function daysBetweenDayKeys(fromKey: string, toKey: string): number {
  const a = Date.parse(`${fromKey}T00:00:00Z`);
  const b = Date.parse(`${toKey}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/**
 * Durum rozeti/uyarı kartı kaynağı. `todayKey` çağıran tarafından `trDayKey()` (clock.ts) ile verilir —
 * bu dosyada saat okunmaz (saf).
 */
export function licenseStatus(
  input: { licenseNo: string | null | undefined; validUntil: string | null | undefined },
  todayKey: string,
): LicenseStatus {
  if (!input.licenseNo || !input.licenseNo.trim()) {
    return { state: "missing", daysLeft: null, threshold: null, tone: "danger", label: "Yetki belgesi no girilmemiş" };
  }
  if (!input.validUntil) {
    return { state: "no_date", daysLeft: null, threshold: null, tone: "neutral", label: "Geçerlilik tarihi girilmemiş" };
  }
  const daysLeft = daysBetweenDayKeys(todayKey, input.validUntil);
  if (daysLeft < 0) {
    return {
      state: "expired",
      daysLeft,
      threshold: null,
      tone: "danger",
      label: `Yetki belgesi süresi ${Math.abs(daysLeft)} gün önce doldu`,
    };
  }
  const threshold = daysLeft <= 7 ? 7 : daysLeft <= 30 ? 30 : daysLeft <= 60 ? 60 : null;
  if (threshold) {
    return {
      state: "expiring",
      daysLeft,
      threshold,
      tone: threshold === 60 ? "warning" : "danger",
      label: daysLeft === 0 ? "Yetki belgesi bugün sona eriyor" : `Yetki belgesi ${daysLeft} gün içinde sona eriyor`,
    };
  }
  return { state: "valid", daysLeft, threshold: null, tone: "ok", label: `Yetki belgesi geçerli (${daysLeft} gün)` };
}

/**
 * İlan yayınında uyarı: yetki belgesi no yoksa ya da süresi dolmuşsa metin döner (yayını ENGELLEMEZ).
 * Kararı kullanıcı verir; yalnız uyarı.
 */
export function listingPublishLicenseWarning(status: LicenseStatus): string | null {
  if (status.state === "missing") {
    return "Ofis yetki belgesi numarası girilmemiş: ilan ve reklamlarda yetki belgesi no yer alması beklenir. Ayarlar > Firma bilgileri'nden ekleyin.";
  }
  if (status.state === "expired") return `${status.label}. Güncel belge bilgisini Ayarlar > Firma bilgileri'nden girin.`;
  return null;
}
