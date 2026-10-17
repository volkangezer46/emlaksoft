import type { ZekaEngineId, ZekaResult, ZekaSurface } from "./types";

/**
 * Sohbet penceresinin konuşma deposu (SAF yardımcılar; depo dışarıdan verilir, testte sahte depo). Konuşma SEKME
 * oturumuna (sessionStorage) ve KULLANICIYA bağlıdır: anahtar son sorgular anahtarının kapsamını taşır
 * (`zeka_recent:app:<kapsam>` → `zeka_conv:app:<kapsam>`); oturumlu yüzeyde kapsam yoksa saklanmaz. Her okuma/yazma
 * try/catch içindedir (gizli pencere, kapalı depo, kota): depo yoksa konuşma yalnız bellekte yaşar. Okunan veri
 * doğrulanır ve kırpılır (en çok 20 tur, 120 KB).
 */

export type StoredTurn = {
  id: number;
  q: string;
  /** Soru anı (epoch ms; saat damgası). */
  at: number;
  status: "done" | "error" | "stopped";
  /** Görünen yanıt metni (durdurulan yanıtta yarım metin). */
  text: string;
  result: ZekaResult | null;
  error: string | null;
  /** Günlük sınır (429) uyarısı. */
  limited?: boolean;
  engine?: ZekaEngineId;
  vote?: 1 | -1;
};

export const ZEKA_CONV_MAX_TURNS = 20;
const MAX_BYTES = 120_000;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Depo anahtarı: app/admin yalnız kullanıcı kapsamıyla; public ortak; vitrin ofis başına. Kapsam yoksa null (saklanmaz). */
export function conversationKey(surface: ZekaSurface, recentsKey: string | null | undefined, slug?: string | null): string | null {
  if (surface === "app" || surface === "admin") return recentsKey && recentsKey.startsWith("zeka_recent:") ? `zeka_conv:${recentsKey.slice("zeka_recent:".length)}` : null;
  if (surface === "vitrin") return slug ? `zeka_conv:vitrin:${String(slug).slice(0, 120)}` : null;
  return "zeka_conv:public";
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

function validResult(v: unknown): ZekaResult | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Partial<ZekaResult>;
  if (typeof r.answer !== "string" || !Array.isArray(r.cards) || !Array.isArray(r.actions) || !Array.isArray(r.followUps)) return null;
  if (r.engine !== "gpt" && r.engine !== "local") return null;
  return r as ZekaResult;
}

function validTurn(v: unknown): StoredTurn | null {
  if (!v || typeof v !== "object") return null;
  const t = v as Record<string, unknown>;
  const status = t.status === "done" || t.status === "error" || t.status === "stopped" ? t.status : null;
  const q = str(t.q, 300);
  if (!status || q.length < 1 || typeof t.id !== "number" || !Number.isFinite(t.id)) return null;
  const result = validResult(t.result);
  if (status === "done" && !result) return null;
  return {
    id: t.id,
    q,
    at: typeof t.at === "number" && Number.isFinite(t.at) ? t.at : 0,
    status,
    text: str(t.text, 8_000),
    result,
    error: typeof t.error === "string" ? t.error.slice(0, 400) : null,
    ...(t.limited === true ? { limited: true } : {}),
    ...(t.engine === "gpt" || t.engine === "local" ? { engine: t.engine } : {}),
    ...(t.vote === 1 || t.vote === -1 ? { vote: t.vote } : {}),
  };
}

export function loadConversation(storage: StorageLike | null | undefined, key: string | null): StoredTurn[] {
  if (!storage || !key) return [];
  try {
    const raw = storage.getItem(key);
    if (!raw || raw.length > MAX_BYTES * 2) return [];
    const parsed: unknown = JSON.parse(raw);
    const list = parsed && typeof parsed === "object" && Array.isArray((parsed as { turns?: unknown }).turns) ? (parsed as { turns: unknown[] }).turns : [];
    return list.map(validTurn).filter((t): t is StoredTurn => t !== null).slice(-ZEKA_CONV_MAX_TURNS);
  } catch {
    return [];
  }
}

/** Yalnız bitmiş turlar yazılır; sığmazsa en eski turlar atılır. Boş liste anahtarı siler. */
export function saveConversation(storage: StorageLike | null | undefined, key: string | null, turns: readonly StoredTurn[]): boolean {
  if (!storage || !key) return false;
  try {
    let list = turns.map(validTurn).filter((t): t is StoredTurn => t !== null).slice(-ZEKA_CONV_MAX_TURNS);
    if (list.length === 0) {
      storage.removeItem(key);
      return true;
    }
    let raw = JSON.stringify({ v: 1, turns: list });
    while (raw.length > MAX_BYTES && list.length > 1) {
      list = list.slice(1);
      raw = JSON.stringify({ v: 1, turns: list });
    }
    if (raw.length > MAX_BYTES) return false;
    storage.setItem(key, raw);
    return true;
  } catch {
    return false;
  }
}

export function clearConversation(storage: StorageLike | null | undefined, key: string | null): void {
  if (!storage || !key) return;
  try {
    storage.removeItem(key);
  } catch {
    // depo kapalı
  }
}

/** Tarayıcı sessionStorage'ı (erişim hata verirse null). */
export function sessionStore(): StorageLike | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}
