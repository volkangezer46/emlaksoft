/**
 * Sistemin kendi yazdığı (insan değişikliği olmayan) ayar anahtarları — SAF. Ayar geçmişinde ve /admin/aktivite'de
 * "Yalnız insan değişiklikleri" süzgeci (varsayılan AÇIK) bunları gizler ve "N sistem kaydı gizlendi" sayar.
 * DB tetikleyicisi değişmez (bu kayıtlar yine yazılır); tetikleyici düzeyinde ayırma sonraki migration turuna kaldı.
 * `*` = önek eşleşmesi; yıldızsız = tam eşleşme.
 */
// `statik.rev`: statik sayfa önbellek sürümü; her yayın sonrası tazelemede sistem artırır (insan değişikliği değil).
// `statik.routes` (Hız ekranındaki aç/kapa) BİLEREK listede yok: personel kararıdır.
export const SYSTEM_KEY_PATTERNS = ["insight_engine_cursor", "seo.audit.*", "seo.indexnow.seen*", "ops.*", "publishing.scheduled", "statik.rev"] as const;

export function isSystemSettingKey(key: string | null | undefined, patterns: readonly string[] = SYSTEM_KEY_PATTERNS): boolean {
  if (!key) return false;
  return patterns.some((p) => (p.endsWith("*") ? key.startsWith(p.slice(0, -1)) : key === p));
}

/** Satırları süzer ve gizlenen sayısını döner (`humanOnly=false` ise hiçbir şey gizlenmez). */
export function filterSystemRows<T>(rows: readonly T[], keyOf: (row: T) => string | null | undefined, humanOnly: boolean): { rows: T[]; hidden: number } {
  if (!humanOnly) return { rows: [...rows], hidden: 0 };
  const kept = rows.filter((r) => !isSystemSettingKey(keyOf(r)));
  return { rows: kept, hidden: rows.length - kept.length };
}

/** URL anahtarı: varsayılan AÇIK; `?sistem=goster` ile kapanır. */
export const SHOW_SYSTEM_PARAM = "sistem";
export function humanOnlyFrom(value: string | string[] | undefined): boolean {
  const v = Array.isArray(value) ? value[0] : value;
  return v !== "goster";
}
