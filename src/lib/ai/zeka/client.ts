"use client";

import type { ZekaResult, ZekaSurface } from "./types";
import { consumeZekaStream, type ZekaStreamHandlers, type ZekaStreamOutcome } from "./stream-protocol";

/**
 * İstemci yardımcıları — BAĞIMLILIKSIZ (ana ekran komut çubuğu ve public giriş kutusu bunu içe aktarsa da paket
 * büyümez; ağır panel ayrı parçadır). Uç noktalar, son sorgular deposu ve fetch sarmalayıcısı.
 */

export const ZEKA_ENDPOINTS: Readonly<Record<ZekaSurface, string>> = {
  app: "/api/zeka",
  admin: "/api/zeka/yonetim",
  public: "/api/zeka/genel",
  vitrin: "/api/zeka/vitrin",
};

export type ZekaFetchResult = { ok: true; result: ZekaResult } | { ok: false; error: string; status: number };

export async function fetchZeka(
  surface: ZekaSurface,
  body: { q: string; mode: "suggest" | "answer" } & Record<string, unknown>,
  signal?: AbortSignal,
): Promise<ZekaFetchResult> {
  try {
    const res = await fetch(ZEKA_ENDPOINTS[surface], {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
      cache: "no-store",
    });
    const json = (await res.json().catch(() => null)) as (ZekaResult & { error?: string }) | null;
    if (!res.ok || !json || json.error) return { ok: false, error: json?.error ?? "Zeka şu an yanıt veremedi.", status: res.status };
    return { ok: true, result: json };
  } catch (e) {
    if ((e as Error)?.name === "AbortError") return { ok: false, error: "", status: 0 };
    return { ok: false, error: "Bağlantı kurulamadı. İnternetinizi kontrol edip tekrar deneyin.", status: 0 };
  }
}

/**
 * AKIŞLI yanıt (sohbet penceresi ve komut çubuğu paneli): `stream: true` ile ister; sunucu SSE dönerse olaylar
 * işleyicilere akar (`stream-protocol.ts`), akış başlamadan reddedilen istek (doğrulama, hız sınırı, yetki) JSON + HTTP
 * durumu olarak aynı sonuç biçimine çevrilir. İptal (Durdur / kapatma) `aborted: true` döner.
 */
export async function streamZeka(
  surface: ZekaSurface,
  body: { q: string } & Record<string, unknown>,
  handlers: ZekaStreamHandlers,
  signal?: AbortSignal,
): Promise<ZekaStreamOutcome> {
  try {
    const res = await fetch(ZEKA_ENDPOINTS[surface], {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({ ...body, mode: "answer", stream: true }),
      signal,
      cache: "no-store",
    });
    if (res.ok && res.body && (res.headers.get("content-type") ?? "").includes("text/event-stream")) return await consumeZekaStream(res.body, handlers, signal);
    const json = (await res.json().catch(() => null)) as (ZekaResult & { error?: string }) | null;
    if (!res.ok || !json || json.error) return { ok: false, error: json?.error ?? "Zeka şu an yanıt veremedi.", status: res.status };
    return { ok: true, result: json };
  } catch (e) {
    if (signal?.aborted || (e as Error)?.name === "AbortError") return { ok: false, error: "", status: 0, aborted: true };
    return { ok: false, error: "Bağlantı kurulamadı. İnternetinizi kontrol edip tekrar deneyin.", status: 0 };
  }
}

export async function sendZekaFeedback(id: string, vote: 1 | -1): Promise<boolean> {
  try {
    const res = await fetch("/api/zeka/geri-bildirim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, vote }) });
    return res.ok;
  } catch {
    return false;
  }
}

/* ----------------------------- Son sorgular (kullanıcı başına) ----------------------------- */

const MAX_RECENT = 6;

/** Anahtar: `recent-key.ts` (komut çubuğu ilk yükü yalnız onu ister). */
export { recentKey } from "./recent-key";

export function readRecent(key: string | null): string[] {
  if (!key) return [];
  try {
    const raw = window.localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 300).slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

export function pushRecent(key: string | null, q: string): string[] {
  const value = q.trim();
  if (!key || value.length < 2) return readRecent(key);
  const next = [value, ...readRecent(key).filter((x) => x.toLocaleLowerCase("tr-TR") !== value.toLocaleLowerCase("tr-TR"))].slice(0, MAX_RECENT);
  try {
    window.localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // depolama kapalı/dolu — yalnız oturum içi
  }
  return next;
}
