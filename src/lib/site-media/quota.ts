/**
 * Site medyası sınırları ve kota (saf; sunucu ve istemci ortak). Toplam kota saklanan VARYANT baytı üzerinden hesaplanır
 * (kaynak dosya saklanmaz, yalnız yeniden kodlanmış çıktılar). İlk ekran bütçesi: hero görselinin 960 px AVIF'i.
 */
export const SITE_MEDIA_LIMITS = {
  /** Toplam saklama kotası (1 GB). */
  totalBytes: 1024 * 1024 * 1024,
  /** Tek dosya giriş sınırı (8 MB). */
  inputBytes: 8 * 1024 * 1024,
  /** En küçük kenar (piksel): daha küçük görsel ana sayfada bulanık görünür. */
  minSide: 200,
  /** Çözülecek en çok piksel (sıkıştırma bombasına karşı). */
  maxPixels: 50_000_000,
  /** İlk ekran görsel bütçesi: 960w AVIF (yüklemede uyarı, kayıtta kalite kapısı). */
  heroBudgetBytes: 120 * 1024,
  /** "Büyük dosya" uyarısı: herhangi bir çıktı varyantı bu sınırı aşarsa. */
  largeOutputBytes: 200 * 1024,
  altMax: 140,
  titleMax: 140,
} as const;

export const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function checkInputSize(bytes: number): string | null {
  if (bytes <= 0) return "Dosya boş.";
  if (bytes > SITE_MEDIA_LIMITS.inputBytes) return `Dosya en fazla ${kb(SITE_MEDIA_LIMITS.inputBytes)} olabilir (bu dosya ${kb(bytes)}).`;
  return null;
}

/** Kota: mevcut kullanım + yeni çıktı (değiştirmede eski çıktı düşülür) toplam sınırı aşamaz. */
export function checkQuota(input: { usedBytes: number; incomingBytes: number; replacingBytes?: number }): string | null {
  const after = Math.max(0, input.usedBytes - (input.replacingBytes ?? 0)) + input.incomingBytes;
  if (after > SITE_MEDIA_LIMITS.totalBytes) {
    return `Medya kotası doldu (${kb(SITE_MEDIA_LIMITS.totalBytes)}). Kullanılmayan görselleri silip tekrar deneyin.`;
  }
  return null;
}

export type VariantLike = { w: number; format: string; bytes: number };

/** İlk ekran ağırlığı: 960 px AVIF; yoksa (küçük kaynak) 960'tan küçük en geniş AVIF. */
export function heroBudget(variants: readonly VariantLike[]): { bytes: number; over: boolean } {
  const avif = variants.filter((v) => v.format === "avif" && v.w <= 960).sort((a, b) => b.w - a.w)[0];
  const bytes = avif?.bytes ?? 0;
  return { bytes, over: bytes > SITE_MEDIA_LIMITS.heroBudgetBytes };
}

/** Hero bütçe aşımı gerekçesinin en kısa uzunluğu (istemci paneli ve sunucu kaydı aynı kural). */
export const HERO_BUDGET_REASON_MIN = 5;

/**
 * Kalite kapısı (SAF; sunucu kaydı ve editör aynı karar): bütçeyi aşan hero görseli YENİ seçiliyorsa (kayıtlı taslakta ve
 * canlıda başka görsel varken) gerekçe zorunludur. Taslakta ya da canlıda zaten olan görsel yeniden gerekçe istemez.
 */
export function heroBudgetNeedsReason(input: { nextId: string | null | undefined; draftId: string | null | undefined; liveId: string | null | undefined; over: boolean }): boolean {
  if (!input.nextId || !input.over) return false;
  return input.nextId !== input.draftId && input.nextId !== input.liveId;
}

export function largestOutput(variants: readonly VariantLike[]): number {
  return variants.reduce((m, v) => Math.max(m, v.bytes), 0);
}

export function isLargeOutput(variants: readonly VariantLike[]): boolean {
  return largestOutput(variants) > SITE_MEDIA_LIMITS.largeOutputBytes;
}

/** Alt metin: zorunlu, tek satır, 1-140 karakter, işaretleme yok. */
export function checkAlt(value: unknown): { ok: true; alt: string } | { ok: false; error: string } {
  const alt = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  if (!alt) return { ok: false, error: "Alt metin zorunludur: görselde ne olduğunu kısaca yazın (ekran okuyucu ve arama motoru bunu okur)." };
  if (alt.length > SITE_MEDIA_LIMITS.altMax) return { ok: false, error: `Alt metin en fazla ${SITE_MEDIA_LIMITS.altMax} karakter olabilir.` };
  if (/[<>]/.test(alt)) return { ok: false, error: "Alt metinde < ve > kullanılamaz." };
  return { ok: true, alt };
}
