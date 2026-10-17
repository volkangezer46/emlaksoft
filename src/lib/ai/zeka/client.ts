"use client";

import type { ZekaResult, ZekaSurface } from "./types";

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

/** Anahtar kullanıcı kapsamlıdır (`zeka_recent:<ofis>:<kullanıcı>`); kapsam yoksa kalıcı tutulmaz. */
export function recentKey(scope: string | undefined, surface: ZekaSurface): string | null {
  return scope ? `zeka_recent:${surface}:${scope}` : null;
}

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
