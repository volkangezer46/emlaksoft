/**
 * MorphTabs saf mantığı — DOM'suz, birim testli.
 *
 * Bileşenler (`components/ui/morph-tabs.tsx`, `morph-tab-parts.tsx`) yalnız bu
 * fonksiyonlardan gelen sonuçla çizer: hangi sekme ne kadar genişler (yoğunluk),
 * ikon üstü rozet ne gösterir, sayaç metni, kullanıcı tercihi (ray daraltma).
 */

export type MorphOrientation = "horizontal" | "vertical";

/**
 * - "full": ikon + etiket + (dikeyde) açıklama/ilerleme — aktif sekme
 * - "label": ikon + etiket — açık rayda pasifler
 * - "icon": yalnız ikon (etiket erişilebilir adda kalır) — yatay pasifler, daralmış ray
 */
export type MorphDensity = "full" | "label" | "icon";

export type MorphDensityInput = {
  /** Bu sekme aktif mi. */
  active: boolean;
  orientation: MorphOrientation;
  /** Yalnız dikey: ray tamamen daraltılmış (ikon-only). */
  railCollapsed?: boolean;
  /** Yalnız daraltılmış ray: üzerine gelinince/odaklanınca geçici genişleme. */
  peek?: boolean;
  /** Yalnız yatay: pasifler "icon" (varsayılan) ya da "label". */
  inactive?: "icon" | "label";
};

export function tabDensity(input: MorphDensityInput): MorphDensity {
  const { active, orientation, railCollapsed = false, peek = false, inactive = "icon" } = input;
  if (orientation === "horizontal") {
    if (active) return "full";
    return inactive === "label" ? "label" : "icon";
  }
  // dikey ray
  if (railCollapsed && !peek) return "icon";
  return active ? "full" : "label";
}

/** Saklanan tercih ("1"/"0"/başka) -> boolean; bilinmeyen değerde varsayılan. */
export function parseStoredFlag(raw: string | null | undefined, fallback: boolean): boolean {
  if (raw === "1") return true;
  if (raw === "0") return false;
  return fallback;
}

export function serializeFlag(value: boolean): string {
  return value ? "1" : "0";
}

// ---- Rozet -----------------------------------------------------------------

export type MorphStatus = "none" | "empty" | "partial" | "missing" | "complete";

export type MorphBadge = {
  kind: "error" | "complete" | "missing" | "none";
  /** Rozet içi metin (yalnız hata sayısı). */
  text: string;
  /** Ekran okuyucu açıklaması. */
  label: string;
};

/** 99'dan büyük sayaçlar "99+" olur (ikon üstünde taşmasın). */
export function formatBadgeCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  return n > 99 ? "99+" : String(Math.floor(n));
}

/**
 * İkon üstü rozet önceliği: hata > eksik zorunlu > tamam. Hata sayısı 0 ise hata rozeti çıkmaz.
 * `missingCount` yalnız açıklama içindir.
 */
export function statusBadge(status: MorphStatus | undefined, errors: number, missingCount = 0): MorphBadge {
  if (errors > 0) return { kind: "error", text: formatBadgeCount(errors), label: `${errors} hatalı alan` };
  if (status === "missing") {
    return { kind: "missing", text: "", label: missingCount > 0 ? `${missingCount} zorunlu alan eksik` : "Zorunlu alan eksik" };
  }
  if (status === "complete") return { kind: "complete", text: "", label: "Tamamlandı" };
  return { kind: "none", text: "", label: "" };
}

/** İlerleme halkası için 0..100 tam sayı (NaN/aralık dışı güvenli). */
export function ringPercent(progress: number | null | undefined): number {
  if (progress == null || !Number.isFinite(progress)) return 0;
  return Math.round(Math.min(1, Math.max(0, progress)) * 100);
}

/** Aktif sekmeyi şeritte ortalayan scrollLeft (negatif olmaz). */
export function centerScrollLeft(tabLeft: number, tabWidth: number, viewWidth: number): number {
  return Math.max(0, Math.round(tabLeft + tabWidth / 2 - viewWidth / 2));
}
