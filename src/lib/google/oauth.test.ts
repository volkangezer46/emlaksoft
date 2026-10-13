import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { GOOGLE_KEYS, GOOGLE_REDIRECT_URI } from "./keys";
import { GoogleApiError } from "./http";
import { buildAuthUrl, disconnectService, exchangeCode, refreshAccessToken } from "./oauth";
import { STATE_TTL_MS, createPkceVerifier, pkceChallengeS256, signState, verifyState } from "./state";
import {
  GoogleSecretsUnavailableError,
  openSealedJson,
  readGoogleSnapshot,
  readToken,
  saveToken,
  sealJson,
  writeSealed,
} from "./token-store";
import { PlaintextSecretError } from "@/lib/settings/secrets";
import { fakeFetch, json, memoryPort, withSecrets } from "./test-support";

const sign = (input: string) => createHmac("sha256", "test-state-key").update(input).digest("base64url");
const A = { staffId: "staff-a", sessionId: "session-1" };
const T0 = 1_760_000_000_000;

let restore: (() => void) | null = null;
afterEach(() => {
  restore?.();
  restore = null;
});

describe("OAuth state (oturuma bağlı, HMAC, 10 dk) + PKCE S256", () => {
  it("PKCE S256 RFC 7636 örneğiyle aynı sonucu verir", () => {
    expect(pkceChallengeS256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    const v = createPkceVerifier();
    expect(v).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("doğru oturum + doğrulayıcı ile geçer", () => {
    const verifier = createPkceVerifier();
    const state = signState({ binding: A, service: "gsc", verifier }, T0, sign)!;
    const r = verifyState(state, A, verifier, T0 + 60_000, sign);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.payload.service).toBe("gsc");
  });

  it("başka oturumda (aynı personel, farklı session_id) ve başka personelde reddedilir", () => {
    const verifier = createPkceVerifier();
    const state = signState({ binding: A, service: "ads", verifier }, T0, sign)!;
    expect(verifyState(state, { staffId: "staff-a", sessionId: "session-2" }, verifier, T0, sign)).toEqual({ ok: false, reason: "oturum" });
    expect(verifyState(state, { staffId: "staff-b", sessionId: "session-1" }, verifier, T0, sign)).toEqual({ ok: false, reason: "oturum" });
  });

  it("süresi dolmuş state reddedilir", () => {
    const verifier = createPkceVerifier();
    const state = signState({ binding: A, service: "gsc", verifier }, T0, sign)!;
    expect(verifyState(state, A, verifier, T0 + STATE_TTL_MS + 1, sign)).toEqual({ ok: false, reason: "sure" });
  });

  it("imzası bozulmuş/değiştirilmiş state ve yanlış doğrulayıcı reddedilir", () => {
    const verifier = createPkceVerifier();
    const state = signState({ binding: A, service: "gsc", verifier }, T0, sign)!;
    expect(verifyState(`${state}x`, A, verifier, T0, sign).ok).toBe(false);
    const other = (i: string) => createHmac("sha256", "baska-anahtar").update(i).digest("base64url");
    expect(verifyState(state, A, verifier, T0, other)).toEqual({ ok: false, reason: "imza" });
    expect(verifyState(state, A, createPkceVerifier(), T0, sign)).toEqual({ ok: false, reason: "dogrulayici" });
    expect(verifyState(state, A, null, T0, sign)).toEqual({ ok: false, reason: "dogrulayici" });
  });

  it("imza anahtarı yoksa state üretilmez ve doğrulanmaz (bağlama reddi)", () => {
    const none = () => null;
    expect(signState({ binding: A, service: "gsc", verifier: createPkceVerifier() }, T0, none)).toBeNull();
    expect(verifyState("a.b", A, createPkceVerifier(), T0, none)).toEqual({ ok: false, reason: "anahtar" });
  });

  it("izin adresi: sabit redirect, S256, offline, artımlı, hizmet başına tek kapsam", () => {
    const url = new URL(buildAuthUrl({ clientId: "x.apps.googleusercontent.com", service: "gsc", state: "s", challenge: "c" }));
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("redirect_uri")).toBe(GOOGLE_REDIRECT_URI);
    expect(GOOGLE_REDIRECT_URI).toBe("https://emlaksoft.com.tr/api/admin/google/callback");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("include_granted_scopes")).toBe("true");
    expect(url.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/webmasters.readonly");
    const ads = new URL(buildAuthUrl({ clientId: "x", service: "ads", state: "s", challenge: "c" }));
    expect(ads.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/adwords");
  });
});

describe("belirteç deposu: düz metin hiç yazılmaz / okunmaz", () => {
  it("şifreleme kapalıyken bağlama (yazma) reddedilir", async () => {
    restore = withSecrets(false);
    const { port, writes } = memoryPort();
    expect(() => sealJson(GOOGLE_KEYS.gsc, { a: 1 })).toThrow(GoogleSecretsUnavailableError);
    await expect(
      saveToken(port, "gsc", { refreshToken: "1//rt", scope: "s", connectedAt: "2026-10-13T00:00:00Z", connectedBy: "x" }, "x"),
    ).rejects.toBeInstanceOf(GoogleSecretsUnavailableError);
    expect(writes).toHaveLength(0);
  });

  it("yazılan her google.* değeri mühürlüdür (v1.) ve düz belirteci içermez", async () => {
    restore = withSecrets(true);
    const { port, writes } = memoryPort();
    await saveToken(port, "gsc", { refreshToken: "1//GIZLI-RT", scope: "s", connectedAt: "2026-10-13T00:00:00Z", connectedBy: "x" }, "x");
    await writeSealed(port, GOOGLE_KEYS.client, { clientId: "id", clientSecret: "GIZLI-SIR" }, "x", "t");
    expect(writes).toHaveLength(2);
    for (const w of writes) {
      expect(w.value.startsWith("v1.")).toBe(true);
      expect(w.value).not.toContain("GIZLI");
    }
    expect((await readToken(port, "gsc"))?.refreshToken).toBe("1//GIZLI-RT");
  });

  it("google.* anahtarında düz metin okunursa hata verilir (sözleşme)", async () => {
    restore = withSecrets(true);
    const { port } = memoryPort({ [GOOGLE_KEYS.gsc]: JSON.stringify({ refreshToken: "duz" }) });
    expect(() => openSealedJson(GOOGLE_KEYS.gsc, '{"refreshToken":"duz"}')).toThrow(PlaintextSecretError);
    await expect(readToken(port, "gsc")).rejects.toBeInstanceOf(PlaintextSecretError);
    const snap = await readGoogleSnapshot(port);
    expect(snap.tokens.gsc).toBeNull();
    expect(snap.problems).toContain(GOOGLE_KEYS.gsc);
  });

  it("başka anahtara taşınmış mühürlü değer açılmaz (AAD = anahtar adı)", () => {
    restore = withSecrets(true);
    const { sealed } = sealJson(GOOGLE_KEYS.ads, { refreshToken: "x" });
    expect(openSealedJson(GOOGLE_KEYS.gsc, sealed)).toBeNull();
    expect(openSealedJson(GOOGLE_KEYS.ads, sealed)).toEqual({ refreshToken: "x" });
  });
});

describe("token uç noktası ve bağlantıyı kesme (sahte fetch)", () => {
  const client = { clientId: "c.apps.googleusercontent.com", clientSecret: "sir" };

  it("kod değişimi PKCE doğrulayıcısını ve sabit redirect'i gönderir", async () => {
    const f = fakeFetch([() => json({ access_token: "at", refresh_token: "rt", scope: "s" })]);
    const r = await exchangeCode({ client, code: "kod", verifier: "v".repeat(43) }, { fetcher: f.fetcher });
    expect(r).toEqual({ refreshToken: "rt", scope: "s" });
    expect(f.calls[0].url).toBe("https://oauth2.googleapis.com/token");
    const body = new URLSearchParams(String(f.calls[0].init.body));
    expect(body.get("code_verifier")).toBe("v".repeat(43));
    expect(body.get("redirect_uri")).toBe(GOOGLE_REDIRECT_URI);
  });

  it("invalid_grant kodu taşınır", async () => {
    const f = fakeFetch([() => json({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, 400)]);
    const err = await refreshAccessToken({ client, refreshToken: "rt" }, { fetcher: f.fetcher }).catch((e) => e);
    expect(err).toBeInstanceOf(GoogleApiError);
    expect((err as GoogleApiError).code).toBe("invalid_grant");
    expect((err as GoogleApiError).message).not.toContain("expired");
  });

  it("bağlantı kesilince revoke çağrılır ve kayıt silinir", async () => {
    restore = withSecrets(true);
    const { port, removed } = memoryPort();
    await saveToken(port, "ads", { refreshToken: "RT-ADS", scope: "s", connectedAt: "t", connectedBy: "x" }, "x");
    const f = fakeFetch([() => new Response(null, { status: 200 })]);
    const r = await disconnectService(port, "ads", "x", { fetcher: f.fetcher });
    expect(r).toEqual({ ok: true, revoked: true });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].url).toBe("https://oauth2.googleapis.com/revoke");
    expect(new URLSearchParams(String(f.calls[0].init.body)).get("token")).toBe("RT-ADS");
    expect(removed).toEqual([GOOGLE_KEYS.ads]);
    expect(await readToken(port, "ads")).toBeNull();
  });

  it("Google sunucu hatasında kayıt SİLİNMEZ (iptal edilmemiş belirteç unutulmaz)", async () => {
    restore = withSecrets(true);
    const { port, removed } = memoryPort();
    await saveToken(port, "gsc", { refreshToken: "RT", scope: "s", connectedAt: "t", connectedBy: "x" }, "x");
    const f = fakeFetch([() => new Response(null, { status: 503 })]);
    const r = await disconnectService(port, "gsc", "x", { fetcher: f.fetcher });
    expect(r.ok).toBe(false);
    expect(removed).toHaveLength(0);
  });
});
