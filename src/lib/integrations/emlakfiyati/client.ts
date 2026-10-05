import "server-only";

import { unstable_cache } from "next/cache";
import { now } from "@/lib/clock";
import {
  emlakFiyatiGet,
  getEmlakFiyatiLastSuccessAt,
  isEmlakFiyatiConfigured,
  resetEmlakFiyatiStateForTests as resetAdapterState,
} from "./adapter";
import {
  buildEndeksPath,
  endeksRequestSchema,
  parentPath,
  parseEndeksResponse,
  summarizeEndeks,
  type EmlakFiyatiTip,
  type EndeksRow,
  type EndeksSummary,
} from "./contract";

/**
 * EmlakFiyati endeks istemcisi (GET /api/endeks?path=&tip=) — YALNIZ `adapter.ts` üzerinden konuşur.
 * Ağ, anahtar çözümleme (admin şifreli > env), geri çekilme, eşzamanlılık sınırı ve hata sınıflandırma adaptördedir;
 * burada yalnız endeks yanıtının yorumlanması ve 12 saatlik `unstable_cache` vardır.
 * İsteğe yalnız coğrafi yol ve tip girer (kişisel veri yok).
 */

export { getEmlakFiyatiLastSuccessAt, isEmlakFiyatiConfigured };

export const EMLAKFIYATI_CACHE_TAG = "emlakfiyati-endeks";
const SUCCESS_TTL_SECONDS = 12 * 60 * 60;
const ERROR_TTL_MS = 5 * 60 * 1000;

const failureUntil = new Map<string, number>();

function negativeKey(path: string, tip: string): string {
  return `${path}|${tip}`;
}

/** Test yardımcısı: bellek içi durumu sıfırlar. */
export function resetEmlakFiyatiStateForTests(): void {
  failureUntil.clear();
  resetAdapterState();
}

class EndeksFetchError extends Error {
  constructor() {
    super("EmlakFiyati endeks isteği başarısız.");
    this.name = "EndeksFetchError";
  }
}

async function fetchEndeksRows(path: string, tip: EmlakFiyatiTip): Promise<EndeksRow[]> {
  // Önbellek bu dosyada (unstable_cache); adaptör belleği burada kapalı.
  const res = await emlakFiyatiGet("/api/endeks", { path, tip }, { cacheTtlMs: 0 });
  if (!res.ok) {
    if (res.kind === "not_found") return [];
    throw new EndeksFetchError();
  }
  const parsed = parseEndeksResponse(res.data);
  if (!parsed.ok) throw new EndeksFetchError();
  return parsed.rows;
}

/** Başarılı/boş sonuçlar 12 saat önbelleklenir; hata atan çağrı önbelleğe YAZILMAZ. */
const cachedEndeksRows = unstable_cache(
  async (path: string, tip: EmlakFiyatiTip): Promise<EndeksRow[]> => fetchEndeksRows(path, tip),
  ["emlakfiyati-endeks-v1"],
  { revalidate: SUCCESS_TTL_SECONDS, tags: [EMLAKFIYATI_CACHE_TAG] },
);

export type EndeksResult =
  | { status: "ok"; summary: EndeksSummary }
  | { status: "empty" }
  | { status: "disabled" }
  | { status: "error" };

/** Tek yol + tip için endeks. Anahtar yoksa "disabled"; hata olsa da ASLA fırlatmaz. */
export async function getEndeks(input: { path: string; tip: EmlakFiyatiTip }): Promise<EndeksResult> {
  if (!(await isEmlakFiyatiConfigured())) return { status: "disabled" };
  const request = endeksRequestSchema.safeParse(input);
  if (!request.success) return { status: "empty" };
  const { path, tip } = request.data;

  const blockedUntil = failureUntil.get(negativeKey(path, tip));
  if (blockedUntil && now() < blockedUntil) return { status: "error" };

  try {
    const rows = await cachedEndeksRows(path, tip);
    const summary = summarizeEndeks(rows, tip);
    return summary ? { status: "ok", summary } : { status: "empty" };
  } catch {
    failureUntil.set(negativeKey(path, tip), now() + ERROR_TTL_MS);
    return { status: "error" };
  }
}

export type EndeksLookup = EndeksResult & { requestedPath: string | null };

/**
 * İl/ilçe/mahalle adlarından en özel yoldan başlayıp veri bulunana dek üst seviyeye iner
 * (mahalle -> ilçe -> il). Dönen özetin `level`/`ad` alanı hangi seviyenin kullanıldığını söyler.
 * Sonuç "error" ise üst seviyeye İNİLMEZ (hata gerçek boşluk değildir).
 */
export async function getEndeksForPlace(input: {
  province?: string | null;
  district?: string | null;
  neighborhood?: string | null;
  tip: EmlakFiyatiTip;
}): Promise<EndeksLookup> {
  const requestedPath = buildEndeksPath(input);
  if (!requestedPath) return { status: "empty", requestedPath: null };
  let path: string | null = requestedPath;
  let last: EndeksResult = { status: "empty" };
  while (path) {
    last = await getEndeks({ path, tip: input.tip });
    if (last.status !== "empty") break;
    path = parentPath(path);
  }
  return { ...last, requestedPath };
}
