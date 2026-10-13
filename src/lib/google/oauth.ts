import { GOOGLE_REDIRECT_URI, GOOGLE_SCOPES, type GoogleService } from "./keys";
import { GoogleApiError, googleExpectOk, googleJson, type GoogleDeps } from "./http";
import { PlaintextSecretError } from "@/lib/settings/secrets";
import { readToken, removeToken, type OAuthClientConfig, type SettingsPort } from "./token-store";

/**
 * Google OAuth 2.0 (web sunucusu akışı + PKCE S256). Hizmet başına ayrı yetkilendirme ve ayrı yenileme belirteci;
 * `include_granted_scopes=true` ile artımlı. Erişim belirteci SAKLANMAZ (her senkronda yenilenir).
 * Adresler sabit; tüm çağrılar `http.ts` izin listesinden geçer.
 */

export const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";

export function buildAuthUrl(input: { clientId: string; service: GoogleService; state: string; challenge: string }): string {
  const q = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: "code",
    scope: GOOGLE_SCOPES[input.service],
    access_type: "offline",
    // Yenileme belirtecinin her bağlamada verilmesi için onay ekranı zorunlu.
    prompt: "consent",
    include_granted_scopes: "true",
    state: input.state,
    code_challenge: input.challenge,
    code_challenge_method: "S256",
  });
  return `${GOOGLE_AUTH_ENDPOINT}?${q.toString()}`;
}

type TokenResponse = { access_token?: string; refresh_token?: string; scope?: string; expires_in?: number; token_type?: string };

function form(body: Record<string, string>): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
    cache: "no-store",
  };
}

/** Yetki kodunu belirteçlere çevirir. Yenileme belirteci gelmezse hata (offline erişim şart). */
export async function exchangeCode(
  input: { client: OAuthClientConfig; code: string; verifier: string },
  deps: GoogleDeps = {},
): Promise<{ refreshToken: string; scope: string }> {
  const res = await googleJson<TokenResponse>(
    GOOGLE_TOKEN_ENDPOINT,
    form({
      grant_type: "authorization_code",
      code: input.code,
      code_verifier: input.verifier,
      client_id: input.client.clientId,
      client_secret: input.client.clientSecret,
      redirect_uri: GOOGLE_REDIRECT_URI,
    }),
    deps,
  );
  if (!res.refresh_token) throw new GoogleApiError(400, "no_refresh_token");
  return { refreshToken: res.refresh_token, scope: res.scope ?? "" };
}

/** Yenileme belirteciyle kısa ömürlü erişim belirteci. `invalid_grant` → GoogleApiError(code=invalid_grant). */
export async function refreshAccessToken(
  input: { client: OAuthClientConfig; refreshToken: string },
  deps: GoogleDeps = {},
): Promise<string> {
  const res = await googleJson<TokenResponse>(
    GOOGLE_TOKEN_ENDPOINT,
    form({
      grant_type: "refresh_token",
      refresh_token: input.refreshToken,
      client_id: input.client.clientId,
      client_secret: input.client.clientSecret,
    }),
    deps,
  );
  if (!res.access_token) throw new GoogleApiError(400, "no_access_token");
  return res.access_token;
}

/** Google revoke uç noktası (yenileme belirtecini iptal eder; bağlı erişim belirteçleri de düşer). */
export async function revokeToken(token: string, deps: GoogleDeps = {}): Promise<void> {
  await googleExpectOk(GOOGLE_REVOKE_ENDPOINT, form({ token }), deps);
}

export type DisconnectResult =
  | {
      ok: true;
      revoked: boolean;
      /**
       * `shared-grant`: diğer hizmet hâlâ bağlı olduğu için Google'da iptal YAPILMADI (artımlı yetkilendirmede iki
       * hizmetin belirteci aynı birleşik izni temsil eder; revoke diğerini de düşürürdü). `plaintext`: kayıt düz
       * metindi (güvenilmez) → iptal denenmeden silindi.
       */
      note?: "shared-grant" | "plaintext";
    }
  | { ok: false; error: string };

/** Diğer hizmetin kullanılabilir (açılabilen, yeniden bağlama beklemeyen) kaydı var mı? Okunamayan kayıt "yok" sayılır. */
async function otherServiceLive(port: SettingsPort, service: GoogleService): Promise<boolean> {
  const other: GoogleService = service === "ads" ? "gsc" : "ads";
  try {
    const rec = await readToken(port, other);
    return Boolean(rec && !rec.needsReconnect);
  } catch {
    return false;
  }
}

/**
 * "Bağlantıyı kes": önce Google'da iptal, sonra kayıt silinir. Google zaten geçersiz saydıysa (400 invalid_token)
 * kayıt yine silinir; ağ/sunucu hatasında kayıt SİLİNMEZ (iptal edilmemiş belirteç unutulmasın) ve hata döner.
 * Diğer hizmet hâlâ bağlıysa iptal YAPILMAZ, yalnız kayıt silinir (`include_granted_scopes` ile alınan belirteçler aynı
 * birleşik izni taşır; revoke diğer hizmeti de koparırdı). Son hizmet kesilirken yapılan iptal birleşik izni kapatır.
 * Düz metin (bozuk) kayıt iptal denenmeden silinir: aksi halde "yeniden bağla" gösteren kayıt hiç temizlenemezdi.
 */
export async function disconnectService(
  port: SettingsPort,
  service: GoogleService,
  actorId: string | null,
  deps: GoogleDeps = {},
): Promise<DisconnectResult> {
  let record: Awaited<ReturnType<typeof readToken>>;
  try {
    record = await readToken(port, service);
  } catch (e) {
    if (!(e instanceof PlaintextSecretError)) throw e;
    const removed = await removeToken(port, service, actorId);
    if (!removed) return { ok: false, error: "Bozuk kayıt silinemedi; lütfen tekrar deneyin." };
    return { ok: true, revoked: false, note: "plaintext" };
  }
  if (!record) {
    await removeToken(port, service, actorId);
    return { ok: true, revoked: false };
  }
  if (await otherServiceLive(port, service)) {
    const removed = await removeToken(port, service, actorId);
    if (!removed) return { ok: false, error: "Kayıt silinemedi; lütfen tekrar deneyin." };
    return { ok: true, revoked: false, note: "shared-grant" };
  }
  let revoked = true;
  try {
    await revokeToken(record.refreshToken, deps);
  } catch (e) {
    if (e instanceof GoogleApiError && e.status === 400) revoked = false;
    else return { ok: false, error: "Google iptal isteği tamamlanamadı; kayıt korunuyor, lütfen tekrar deneyin." };
  }
  const removed = await removeToken(port, service, actorId);
  if (!removed) return { ok: false, error: "Google'da iptal edildi ancak kayıt silinemedi; lütfen tekrar deneyin." };
  return { ok: true, revoked };
}
