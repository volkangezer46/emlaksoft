import type { SettingsPort } from "./token-store";

/**
 * Google testleri için bellek içi ayar deposu ve sahte istemci. YALNIZ testlerde kullanılır; üretim kodu import etmez.
 * Depo, yazılan ham değerleri saklar: testler düz metnin hiç yazılmadığını doğrudan görebilir.
 */

export const TEST_SECRETS_KEY = "a".repeat(64);
const SECRET_ENVS = ["PLATFORM_SECRETS_KEY", "OTP_HMAC_SECRET", "TWO_FACTOR_COOKIE_SECRET", "PROPERTY_MEDIA_SIGNING_SECRET"] as const;

export function withSecrets(enabled: boolean): () => void {
  const saved = Object.fromEntries(SECRET_ENVS.map((k) => [k, process.env[k]]));
  for (const k of SECRET_ENVS) delete process.env[k];
  if (enabled) process.env.PLATFORM_SECRETS_KEY = TEST_SECRETS_KEY;
  return () => {
    for (const k of SECRET_ENVS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  };
}

export function memoryPort(initial: Record<string, string> = {}) {
  const data = new Map<string, string>(Object.entries(initial));
  const writes: Array<{ key: string; value: string }> = [];
  const removed: string[] = [];
  const port: SettingsPort = {
    async read(keys) {
      return Object.fromEntries(keys.map((k) => [k, data.get(k) ?? null]));
    },
    async write(key, sealed) {
      writes.push({ key, value: sealed });
      data.set(key, sealed);
      return true;
    },
    async remove(key) {
      removed.push(key);
      data.delete(key);
      return true;
    },
  };
  return { port, data, writes, removed };
}

export type FakeCall = { url: string; init: RequestInit };

/** Sırayla yanıt veren sahte fetch; her çağrıyı kaydeder. */
export function fakeFetch(responses: Array<(call: FakeCall) => Response>) {
  const calls: FakeCall[] = [];
  let i = 0;
  const fetcher = async (url: string, init: RequestInit) => {
    const call = { url, init };
    calls.push(call);
    const make = responses[Math.min(i, responses.length - 1)];
    i += 1;
    if (!make) throw new Error("beklenmeyen çağrı");
    return make(call);
  };
  return { fetcher, calls };
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
