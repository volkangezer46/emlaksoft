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
 * Ünvan/adres değişikliğinde yetki belgesi tadili: değişiklikten sonra kaç gün içinde başvurulması beklendiği.
 * Değer ürün sahibi bildirimidir (Taşınmaz Ticareti Hakkında Yönetmelik; resmî metin bu depoda açılmadı) —
 * görünür metinde "doğrulayın" notuyla kullanılır.
 */
export const LICENSE_AMENDMENT_DAYS = 10;

export type LicenseAmendmentSnapshot = {
  name: string | null;
  addressLine: string | null;
  licenseTitle: string | null;
  provinceId: string | null;
  districtId: string | null;
};

const clean = (v: string | null | undefined) => String(v ?? "").replace(/\s+/g, " ").trim().toLocaleLowerCase("tr-TR");

/**
 * Yetki belgesinde yazan bilgilerden (işletme adı/ünvanı, adres, il/ilçe) hangileri değişti? Boş liste = tadil gerekmez.
 * Boşluk/büyük-küçük harf farkı değişiklik sayılmaz. Yeni değer boşsa (alan temizlendi) değişiklik sayılmaz.
 */
export function licenseAmendmentChanges(prev: LicenseAmendmentSnapshot, next: LicenseAmendmentSnapshot): string[] {
  const out: string[] = [];
  const changed = (a: string | null, b: string | null) => clean(b) !== "" && clean(a) !== clean(b);
  if (changed(prev.name, next.name)) out.push("işletme adı");
  if (changed(prev.licenseTitle, next.licenseTitle)) out.push("belge ünvanı");
  if (changed(prev.addressLine, next.addressLine)) out.push("adres");
  if ((next.provinceId && prev.provinceId !== next.provinceId) || (next.districtId && prev.districtId !== next.districtId)) {
    if (!out.includes("adres")) out.push("adres (il/ilçe)");
  }
  return out;
}

/** Tadil hatırlatma metni (tek kaynak: görev + bildirim). */
export function licenseAmendmentMessage(changes: readonly string[]): { title: string; body: string } {
  return {
    title: "Yetki belgesi tadili: ünvan/adres değişti",
    body:
      `Değişen bilgi: ${changes.join(", ")}. Yetki belgesindeki bilgilerin değişikliğinden itibaren ${LICENSE_AMENDMENT_DAYS} gün içinde ` +
      "tadil başvurusu yapılması beklenir (süreyi ve başvuru yerini güncel mevzuattan doğrulayın).",
  };
}

/**
 * Yıllık yetki belgesi harcı/ödeme kontrolü hatırlatması: ofis ayarındaki ay (1-12; 0 = kapalı) geldiğinde yılda bir kez.
 * Tutar veya son gün YAZILMAZ (ofis kendi belgesinden doğrular). `todayKey` = trDayKey(); saf.
 */
export function annualLicenseFeeReminderDue(month: number, todayKey: string): boolean {
  if (!Number.isInteger(month) || month < 1 || month > 12) return false;
  return Number(todayKey.slice(5, 7)) === month;
}

/** Cron'un 60/30/7 gün + süresi dolan kademesi (tek seferlik bildirim anahtarı için). Bildirim gerekmiyorsa null. */
export function licenseExpiryReminderStep(validUntil: string | null | undefined, todayKey: string): "60" | "30" | "7" | "expired" | null {
  if (!validUntil) return null;
  const s = licenseStatus({ licenseNo: "x", validUntil }, todayKey);
  if (s.state === "expired") return s.daysLeft !== null && s.daysLeft >= -30 ? "expired" : null;
  if (s.state !== "expiring" || s.threshold === null) return null;
  return String(s.threshold) as "60" | "30" | "7";
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
