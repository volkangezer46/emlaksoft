/**
 * Sekmeli form (TabbedFormShell) saf mantığı — DOM'suz, birim testli.
 *
 * Kabuk bileşeni (`components/ui/tabbed-form-shell.tsx`) yalnız bu fonksiyonları
 * çağırır: sekme gezinmesi, tamamlanma, hata -> ilk bozuk sekme, taslak beyaz
 * listesi ve süre dolumu. Zaman okuması çağırandan gelir (`clock.ts`), burada yok.
 */

/** Sekmenin saf (UI'sız) tanımı: kabuk `FormTab` bunu genişletir. */
export type TabDef = {
  id: string;
  /** Bu sekmedeki TÜM alan name'leri (sözleşme testi form kaynağıyla eşler). */
  fields: readonly string[];
  /** Zorunlu alan name'leri (fields'in alt kümesi). */
  required?: readonly string[];
  /**
   * Önceden seçili gelen alanlar (ör. varsayılan "Satılık"): kullanıcı bir şey yazmadan
   * dolu görünürler, bu yüzden isteğe bağlı sekmenin "tamamlandı" sayılmasına katkı vermez.
   */
  passive?: readonly string[];
};

export type FormValues = Record<string, string>;

// ---- Gezinme ---------------------------------------------------------------

export type TabNavKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight" | "Home" | "End";

export function isTabNavKey(key: string): key is TabNavKey {
  return (
    key === "ArrowUp" || key === "ArrowDown" || key === "ArrowLeft" || key === "ArrowRight" || key === "Home" || key === "End"
  );
}

/**
 * WAI-ARIA sekme deseni: Yukarı/Sol önceki, Aşağı/Sağ sonraki (uçlarda döner),
 * Home ilk, End son. Bilinmeyen `current` ilk sekmeye düşer.
 */
export function nextTabId(ids: readonly string[], current: string, key: TabNavKey): string {
  if (ids.length === 0) return current;
  const i = ids.indexOf(current);
  if (key === "Home") return ids[0];
  if (key === "End") return ids[ids.length - 1];
  if (i < 0) return ids[0];
  const step = key === "ArrowDown" || key === "ArrowRight" ? 1 : -1;
  return ids[(i + step + ids.length) % ids.length];
}

/** Geçersiz/boş `?sekme=` değeri için güvenli başlangıç sekmesi. */
export function resolveInitialTab(ids: readonly string[], wanted: string | null | undefined): string {
  if (wanted && ids.includes(wanted)) return wanted;
  return ids[0] ?? "";
}

/** Sonraki/önceki komşu (dönmeden); uçta null. */
export function neighborTabId(ids: readonly string[], current: string, dir: 1 | -1): string | null {
  const i = ids.indexOf(current);
  if (i < 0) return null;
  return ids[i + dir] ?? null;
}

// ---- Tamamlanma ------------------------------------------------------------

export type TabStatus = "none" | "empty" | "partial" | "missing" | "complete";

export type TabState = {
  /** Zorunlu alanların hepsi dolu (zorunlusuz sekmede: en az bir alan dolu). */
  complete: boolean;
  /** Boş zorunlu alan name'leri. */
  missing: string[];
  /** Dolu alan sayısı (fields içinden). */
  filled: number;
  status: TabStatus;
};

const isFilled = (v: string | undefined) => (v ?? "").trim() !== "";

/**
 * - alan yok -> "none" (bilgi sekmesi; ilerlemeye girmez)
 * - zorunlu var ve hepsi dolu -> "complete"; eksik var -> "missing"
 * - zorunlu yok: en az bir alan dolu -> "complete", hiçbiri -> "empty"
 */
export function computeTabState(tab: Pick<TabDef, "fields" | "required" | "passive">, values: FormValues): TabState {
  const required = tab.required ?? [];
  const missing = required.filter((n) => !isFilled(values[n]));
  const filled = tab.fields.filter((n) => isFilled(values[n])).length;
  // İsteğe bağlı sekmede yalnız kullanıcının doldurduğu (ön dolu olmayan) alanlar sayılır.
  const userFilled = tab.fields.filter((n) => !(tab.passive ?? []).includes(n) && isFilled(values[n])).length;
  if (tab.fields.length === 0 && required.length === 0) return { complete: false, missing, filled: 0, status: "none" };
  if (required.length > 0) {
    const complete = missing.length === 0;
    return { complete, missing, filled, status: complete ? "complete" : "missing" };
  }
  return { complete: userFilled > 0, missing, filled, status: userFilled > 0 ? "complete" : "empty" };
}

/** Rayın altındaki "N/M bölüm tamam": bilgi sekmeleri (status none) M'ye girmez. */
export function progressSummary(tabs: readonly TabDef[], values: FormValues): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const t of tabs) {
    const s = computeTabState(t, values);
    if (s.status === "none") continue;
    total += 1;
    if (s.complete) done += 1;
  }
  return { done, total };
}

/**
 * Sekme ilerlemesi 0..1 (ikon halkası): zorunlu varsa dolu zorunlu/zorunlu; yoksa
 * en az bir alan doluysa 1 ("tamam" ile tutarlı). Bilgi sekmesi (alan yok) 0.
 */
export function tabProgress(tab: Pick<TabDef, "fields" | "required" | "passive">, values: FormValues): number {
  const required = tab.required ?? [];
  if (required.length > 0) {
    return required.filter((n) => isFilled(values[n])).length / required.length;
  }
  if (tab.fields.length === 0) return 0;
  const passive = tab.passive ?? [];
  return tab.fields.some((n) => !passive.includes(n) && isFilled(values[n])) ? 1 : 0;
}

export type SlideDirection = "next" | "prev" | "none";

/** Panel geçişinin yönü (CSS `data-dir`): sıradaki sekmeye ileri, öncekine geri. */
export function slideDirection(ids: readonly string[], from: string, to: string): SlideDirection {
  const a = ids.indexOf(from);
  const b = ids.indexOf(to);
  if (a < 0 || b < 0 || a === b) return "none";
  return b > a ? "next" : "prev";
}

/** Alan name'inin ait olduğu sekme (yoksa null). */
export function tabForField(tabs: readonly TabDef[], fieldName: string): string | null {
  return tabs.find((t) => t.fields.includes(fieldName))?.id ?? null;
}

/**
 * Hatalı alan name'leri arasından SEKME SIRASINDA ilk bozuk sekmeyi bulur
 * (invalid olayları DOM sırasıyla gelir, ama sunucu hata eşlemesi sırasızdır).
 */
export function firstInvalidTab(tabs: readonly TabDef[], invalidNames: readonly string[]): string | null {
  for (const t of tabs) {
    if (invalidNames.some((n) => t.fields.includes(n))) return t.id;
  }
  return null;
}

// ---- Taslak ----------------------------------------------------------------

/** Ne olursa olsun taslağa yazılmayan alan adı kalıpları (beyaz listeye yanlışlıkla girse bile). */
const SENSITIVE_NAME = /(phone|tel|gsm|mobile|e_?mail|eposta|tc|tckn|identity|iban|card|password|secret|token|body|notes?|description|message|address)/i;

export function isSensitiveFieldName(name: string): boolean {
  return SENSITIVE_NAME.test(name);
}

/**
 * Taslağa yalnız beyaz listedeki VE hassas olmayan, dolu alanları geçirir.
 * Savunma katmanı: beyaz listeye telefon/e-posta/not eklense bile `isSensitiveFieldName` eler.
 */
export function pickDraftFields(values: FormValues, whitelist: readonly string[]): FormValues {
  const out: FormValues = {};
  for (const name of whitelist) {
    if (isSensitiveFieldName(name)) continue;
    const v = values[name];
    if (typeof v === "string" && v.trim() !== "") out[name] = v;
  }
  return out;
}

export const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const DRAFT_VERSION = 1;

export function draftStorageKey(userId: string, formId: string): string {
  return `emlaksoft:draft:v${DRAFT_VERSION}:${userId}:${formId}`;
}

/** Bu kullanıcıya ait TÜM taslakların anahtar öneki (çıkışta toplu temizlik için). */
export function draftKeyPrefix(userId: string): string {
  return `emlaksoft:draft:v${DRAFT_VERSION}:${userId}:`;
}

export type DraftPayload = { v: number; savedAt: number; values: FormValues };

export function encodeDraft(values: FormValues, savedAt: number): string {
  const payload: DraftPayload = { v: DRAFT_VERSION, savedAt, values };
  return JSON.stringify(payload);
}

/** Bozuk JSON, yanlış sürüm, süresi dolmuş, boş veya geleceğe ait kayıt -> null. */
export function parseDraft(raw: string | null | undefined, nowMs: number, ttlMs: number = DRAFT_TTL_MS): DraftPayload | null {
  if (!raw) return null;
  try {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== "object") return null;
    const { v, savedAt, values } = data as Partial<DraftPayload>;
    if (v !== DRAFT_VERSION || typeof savedAt !== "number" || !Number.isFinite(savedAt)) return null;
    if (nowMs - savedAt > ttlMs || savedAt - nowMs > 60_000) return null;
    if (!values || typeof values !== "object" || Array.isArray(values)) return null;
    const clean: FormValues = {};
    for (const [k, val] of Object.entries(values)) {
      if (typeof val === "string" && !isSensitiveFieldName(k)) clean[k] = val;
    }
    if (Object.keys(clean).length === 0) return null;
    return { v, savedAt, values: clean };
  } catch {
    return null;
  }
}

/** "14:32" — saat biçimi (yerel saat). Zaman damgası çağırandan gelir. */
export function formatClock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Aynı gün "bugün 14:32", değilse "03.10 14:32" (bant metni için). */
export function formatDraftTime(ms: number, nowMs: number): string {
  const d = new Date(ms);
  const n = new Date(nowMs);
  const sameDay = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  if (sameDay) return `bugün ${formatClock(ms)}`;
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")} ${formatClock(ms)}`;
}

// ---- Özet hesapları --------------------------------------------------------

/** Türkçe sayı girdisini ("6.750.000", "6750000,50", "3,5") sayıya çevirir; geçersiz/negatif -> null. */
export function parseLooseNumber(input: string | null | undefined): number | null {
  const raw = (input ?? "").trim().replace(/\s/g, "");
  if (!raw || !/^\d[\d.,]*$/.test(raw)) return null;
  let s = raw;
  const hasComma = s.includes(",");
  const dots = (s.match(/\./g) ?? []).length;
  if (hasComma) s = s.replace(/\./g, "").replace(",", ".");
  else if (dots > 1 || /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export type CommissionSummary = { amount: number; perSqm: number | null } | null;

/**
 * Liste fiyatı x komisyon oranı (%) = tahmini komisyon (KDV hariç, kuruşa yuvarlı).
 * Fiyat/oran boş, geçersiz, negatif, fiyat 0 veya oran > 100 ise null (sahte sayı yok).
 * `perSqm`: fiyat / m² (m² geçerli ve > 0 ise).
 */
export function commissionSummary(
  price: string | number | null | undefined,
  rate: string | number | null | undefined,
  sqm?: string | number | null,
): CommissionSummary {
  const p = typeof price === "number" ? price : parseLooseNumber(price);
  const r = typeof rate === "number" ? rate : parseLooseNumber(rate);
  if (p == null || r == null || p <= 0 || r <= 0 || r > 100) return null;
  const q = typeof sqm === "number" ? sqm : parseLooseNumber(sqm ?? "");
  return {
    amount: Math.round(p * r) / 100,
    perSqm: q != null && q > 0 ? Math.round(p / q) : null,
  };
}
