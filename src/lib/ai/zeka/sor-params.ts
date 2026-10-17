import { sanitizePage } from "./context";

/**
 * /sor ("EmlakSoft'a sor") sayfasının SAF parametre çözümleyicisi (yalnız sunucu sayfası; istemci paketine girmez,
 * çünkü `sanitizePage` NLU bağlam modülündedir).
 * Sayfa searchParams'ı SUNUCUDA okur ve buradan geçirip sohbete prop olarak verir (istemcide useSearchParams yok).
 */

export type SorSearchParams = Record<string, string | string[] | undefined>;

export type SorParams = {
  /** Açılışta bir kez sorulacak soru (2–300 karakter); yoksa null. */
  q: string | null;
  /** Sohbetin sayfa bağlamı (`?from=` güvenli yol ise o, değilse "/sor"). */
  from: string;
  /** Sorgu dizesi var mı (varsa sayfa noindex). */
  hasQuery: boolean;
};

const first = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? "") : (v ?? ""));

export function parseSorParams(sp: SorSearchParams): SorParams {
  const raw = first(sp.q).replace(/\s+/g, " ").trim().slice(0, 300);
  const from = sanitizePage(first(sp.from)) ?? "/sor";
  return { q: raw.length >= 2 ? raw : null, from, hasQuery: Object.values(sp).some((v) => v !== undefined) };
}

