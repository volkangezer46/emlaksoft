"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { now } from "@/lib/clock";
import { normalizeCustomerId, isValidApiVersion, probeAdsAccount } from "@/lib/google/ads";
import { platformSettingsPort } from "@/lib/google/db";
import { listSites, suggestProperty, type GscSite } from "@/lib/google/gsc";
import { GoogleApiError, isInvalidGrant } from "@/lib/google/http";
import { GOOGLE_KEYS, GOOGLE_SERVICE_LABELS, type GoogleService } from "@/lib/google/keys";
import { buildAuthUrl, disconnectService, refreshAccessToken } from "@/lib/google/oauth";
import { GOOGLE_PKCE_COOKIE, PKCE_COOKIE_OPTIONS, currentSessionBinding, googleStateSigner } from "@/lib/google/session";
import { createPkceVerifier, pkceChallengeS256, signState } from "@/lib/google/state";
import {
  GoogleSecretsUnavailableError,
  patchToken,
  readGoogleSnapshot,
  writeSealed,
  type AdsAccountConfig,
  type OAuthClientConfig,
} from "@/lib/google/token-store";
import { logPlatformActivity } from "@/lib/platform-activity";
import { guardPlatformAction } from "@/lib/platform-guards";
import { secretsWritable } from "@/lib/settings/secrets";

/**
 * Google bağlantı merkezi eylemleri. Bağlama, kesme ve gizli değer girme YALNIZ super_admin (modül `reklam`; ops ekranı
 * salt okur). Gizli değerler mühürlenemiyorsa (PLATFORM_SECRETS_KEY / türetilmiş anahtar yok) işlem REDDEDİLİR.
 * Google'a giden çağrılar yalnız kullanıcı tıklamasıyla (mülk listesi, Ads hesap denemesi, iptal) yapılır; sayfa
 * çiziminde dış çağrı yoktur. Denetim izine gizli değer YAZILMAZ.
 */

export type GoogleActionResult = { ok?: boolean; error?: string; message?: string; url?: string; sites?: GscSite[]; suggested?: string | null };

const SECRETS_OFF = "Şifreleme anahtarı tanımlı değil; Google bilgileri düz metin olarak saklanmaz, bağlantı kurulamaz.";
const PAGE = "/admin/site/baglantilar";

async function superGuard() {
  return guardPlatformAction({ module: "reklam", roles: ["super_admin"], rate: { key: "google-connect", limit: 30, windowSec: 600 } });
}

function refresh() {
  revalidatePath(PAGE);
  revalidatePath("/admin/seo/performans");
  revalidatePath("/admin/site/reklam/google");
}

function failure(e: unknown, fallback: string): GoogleActionResult {
  if (e instanceof GoogleSecretsUnavailableError) return { error: SECRETS_OFF };
  if (isInvalidGrant(e)) return { error: "Google erişimi geri çekmiş; hizmeti yeniden bağlayın." };
  if (e instanceof GoogleApiError) return { error: `${fallback} (Google yanıtı: ${e.status}${e.code ? `, ${e.code}` : ""})` };
  return { error: fallback };
}

const ClientSchema = z.object({
  clientId: z
    .string()
    .trim()
    .max(200)
    .regex(/^[0-9A-Za-z\-_.]+\.apps\.googleusercontent\.com$/, "İstemci kimliği ….apps.googleusercontent.com ile bitmelidir."),
  clientSecret: z.string().trim().max(200),
});

/** Adım 2: OAuth istemci kimliği + sırrı (mühürlü). Sır boş bırakılırsa mevcut sır korunur. */
export async function saveGoogleClient(fd: FormData): Promise<GoogleActionResult> {
  const g = await superGuard();
  if ("error" in g) return { error: g.error };
  if (!secretsWritable()) return { error: SECRETS_OFF };
  const parsed = ClientSchema.safeParse({ clientId: fd.get("clientId") ?? "", clientSecret: fd.get("clientSecret") ?? "" });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Geçersiz değer." };
  try {
    const snap = await readGoogleSnapshot(platformSettingsPort);
    const secret = parsed.data.clientSecret || snap.client?.clientSecret || "";
    if (secret.length < 8) return { error: "İstemci sırrını girin." };
    const value: OAuthClientConfig = { clientId: parsed.data.clientId, clientSecret: secret };
    const ok = await writeSealed(platformSettingsPort, GOOGLE_KEYS.client, value, g.staff.id, "OAuth istemcisi kaydedildi");
    if (!ok) return { error: "Kaydedilemedi; lütfen tekrar deneyin." };
    await logPlatformActivity({ actorId: g.staff.id, action: "google.client_saved", entityType: "google", meta: { secretChanged: Boolean(parsed.data.clientSecret) } });
    refresh();
    return { ok: true, message: "OAuth istemcisi kaydedildi (şifreli)." };
  } catch (e) {
    return failure(e, "Kaydedilemedi; lütfen tekrar deneyin.");
  }
}

const ServiceSchema = z.enum(["gsc", "ads"]);

/** Adım 3/5: Google izin ekranını başlatır (state oturuma bağlı + PKCE S256). İstemci dönen adrese gider. */
export async function startGoogleConnect(service: GoogleService): Promise<GoogleActionResult> {
  const g = await superGuard();
  if ("error" in g) return { error: g.error };
  const svc = ServiceSchema.safeParse(service);
  if (!svc.success) return { error: "Bilinmeyen hizmet." };
  if (!secretsWritable()) return { error: SECRETS_OFF };
  const snap = await readGoogleSnapshot(platformSettingsPort);
  if (!snap.client) return { error: "Önce OAuth istemci kimliğini girin (2. adım)." };
  if (svc.data === "ads" && !snap.adsAccount) return { error: "Önce Ads müşteri kimliği ve developer token'ı girin (4. adım)." };
  const binding = await currentSessionBinding(g.staff.id);
  if (!binding) return { error: "Oturum doğrulanamadı; sayfayı yenileyip tekrar deneyin." };
  const verifier = createPkceVerifier();
  const state = signState({ binding, service: svc.data, verifier }, now(), googleStateSigner);
  if (!state) return { error: SECRETS_OFF };
  (await cookies()).set({ name: GOOGLE_PKCE_COOKIE, value: verifier, ...PKCE_COOKIE_OPTIONS });
  await logPlatformActivity({ actorId: g.staff.id, action: "google.connect_started", entityType: "google", meta: { service: svc.data } });
  return { ok: true, url: buildAuthUrl({ clientId: snap.client.clientId, service: svc.data, state, challenge: pkceChallengeS256(verifier) }) };
}

/** Adım 3: Search Console mülk listesi (kullanıcı tıklamasıyla Google'a gider). */
export async function listGscProperties(): Promise<GoogleActionResult> {
  const g = await superGuard();
  if ("error" in g) return { error: g.error };
  try {
    const snap = await readGoogleSnapshot(platformSettingsPort);
    if (!snap.client || !snap.tokens.gsc) return { error: "Önce Search Console'u bağlayın." };
    const access = await refreshAccessToken({ client: snap.client, refreshToken: snap.tokens.gsc.refreshToken });
    const sites = await listSites(access);
    return { ok: true, sites, suggested: suggestProperty(sites) };
  } catch (e) {
    if (isInvalidGrant(e)) await patchToken(platformSettingsPort, "gsc", { needsReconnect: true, lastError: "invalid_grant" }).catch(() => false);
    return failure(e, "Mülk listesi alınamadı; bağlantıyı kontrol edip tekrar deneyin.");
  }
}

/** Mülk seçimi: yalnız Google'ın bu hesap için döndürdüğü listeden biri kabul edilir. */
export async function selectGscProperty(fd: FormData): Promise<GoogleActionResult> {
  const g = await superGuard();
  if ("error" in g) return { error: g.error };
  const siteUrl = String(fd.get("siteUrl") ?? "").trim();
  if (!siteUrl || siteUrl.length > 300) return { error: "Bir mülk seçin." };
  try {
    const snap = await readGoogleSnapshot(platformSettingsPort);
    if (!snap.client || !snap.tokens.gsc) return { error: "Önce Search Console'u bağlayın." };
    const access = await refreshAccessToken({ client: snap.client, refreshToken: snap.tokens.gsc.refreshToken });
    const sites = await listSites(access);
    if (!sites.some((s) => s.siteUrl === siteUrl)) return { error: "Seçilen mülk bu Google hesabında bulunamadı." };
    const ok = await writeSealed(platformSettingsPort, GOOGLE_KEYS.gscProperty, { siteUrl }, g.staff.id, "Search Console mülkü seçildi");
    if (!ok) return { error: "Kaydedilemedi; lütfen tekrar deneyin." };
    await logPlatformActivity({ actorId: g.staff.id, action: "google.gsc_property", entityType: "google", meta: { siteUrl } });
    refresh();
    return { ok: true, message: "Mülk kaydedildi. Veriler bu gece 03:10'da (TR 06:10) gelmeye başlar." };
  } catch (e) {
    return failure(e, "Mülk kaydedilemedi; listeyi yenileyip tekrar seçin.");
  }
}

const AdsSchema = z.object({
  customerId: z.string().trim().max(20),
  loginCustomerId: z.string().trim().max(20),
  developerToken: z.string().trim().max(100),
  apiVersion: z.string().trim().max(5),
});

/** Adım 4: Ads müşteri kimliği, MCC ve developer token (mühürlü). Token boş bırakılırsa mevcut korunur. */
export async function saveAdsAccount(fd: FormData): Promise<GoogleActionResult> {
  const g = await superGuard();
  if ("error" in g) return { error: g.error };
  if (!secretsWritable()) return { error: SECRETS_OFF };
  const parsed = AdsSchema.safeParse({
    customerId: fd.get("customerId") ?? "",
    loginCustomerId: fd.get("loginCustomerId") ?? "",
    developerToken: fd.get("developerToken") ?? "",
    apiVersion: fd.get("apiVersion") ?? "",
  });
  if (!parsed.success) return { error: "Geçersiz değer." };
  const customerId = normalizeCustomerId(parsed.data.customerId);
  if (!customerId) return { error: "Müşteri kimliği 10 haneli olmalı (ör. 123-456-7890)." };
  const loginRaw = parsed.data.loginCustomerId;
  const loginCustomerId = loginRaw ? normalizeCustomerId(loginRaw) : null;
  if (loginRaw && !loginCustomerId) return { error: "Yönetici hesap (MCC) kimliği 10 haneli olmalı." };
  if (parsed.data.apiVersion && !isValidApiVersion(parsed.data.apiVersion)) return { error: "API sürümü v22 biçiminde olmalı." };
  try {
    const snap = await readGoogleSnapshot(platformSettingsPort);
    const developerToken = parsed.data.developerToken || snap.adsAccount?.developerToken || "";
    if (developerToken.length < 10) return { error: "Developer token'ı girin." };
    const value: AdsAccountConfig = { customerId, loginCustomerId, developerToken, apiVersion: parsed.data.apiVersion || null };
    const ok = await writeSealed(platformSettingsPort, GOOGLE_KEYS.adsAccount, value, g.staff.id, "Ads hesap ayarları kaydedildi");
    if (!ok) return { error: "Kaydedilemedi; lütfen tekrar deneyin." };
    await logPlatformActivity({
      actorId: g.staff.id,
      action: "google.ads_account",
      entityType: "google",
      meta: { mcc: Boolean(loginCustomerId), tokenChanged: Boolean(parsed.data.developerToken) },
    });
    refresh();
    return { ok: true, message: "Ads hesap ayarları kaydedildi (şifreli)." };
  } catch (e) {
    return failure(e, "Kaydedilemedi; lütfen tekrar deneyin.");
  }
}

/** Ads bağlantısını dener (tek satırlık okuma sorgusu). */
export async function testAdsConnection(): Promise<GoogleActionResult> {
  const g = await superGuard();
  if ("error" in g) return { error: g.error };
  try {
    const snap = await readGoogleSnapshot(platformSettingsPort);
    if (!snap.client || !snap.tokens.ads || !snap.adsAccount) return { error: "Önce Ads'i bağlayın." };
    const access = await refreshAccessToken({ client: snap.client, refreshToken: snap.tokens.ads.refreshToken });
    const info = await probeAdsAccount({ ...snap.adsAccount, accessToken: access });
    return { ok: true, message: `Hesaba erişildi${info.name ? `: ${info.name}` : ""}${info.currency ? ` (${info.currency})` : ""}.` };
  } catch (e) {
    if (isInvalidGrant(e)) await patchToken(platformSettingsPort, "ads", { needsReconnect: true, lastError: "invalid_grant" }).catch(() => false);
    return failure(e, "Ads hesabına erişilemedi; müşteri kimliğini ve developer token'ı kontrol edin.");
  }
}

/** "Bağlantıyı kes": Google revoke uç noktasında iptal + kayıt silinir. */
export async function disconnectGoogle(service: GoogleService): Promise<GoogleActionResult> {
  const g = await superGuard();
  if ("error" in g) return { error: g.error };
  const svc = ServiceSchema.safeParse(service);
  if (!svc.success) return { error: "Bilinmeyen hizmet." };
  try {
    const r = await disconnectService(platformSettingsPort, svc.data, g.staff.id);
    if (!r.ok) return { error: r.error };
    await logPlatformActivity({
      actorId: g.staff.id,
      action: "google.disconnect",
      entityType: "google",
      meta: { service: svc.data, revoked: r.revoked, note: r.note ?? null },
    });
    refresh();
    const label = GOOGLE_SERVICE_LABELS[svc.data];
    if (r.note === "shared-grant") {
      return {
        ok: true,
        message: `${label} bağlantısı kesildi ve belirteç silindi. Diğer Google hizmeti aynı izni kullandığı için Google'daki izin iptal edilmedi; o hizmeti de kestiğinizde izin tümüyle iptal edilir.`,
      };
    }
    if (r.note === "plaintext") return { ok: true, message: `${label} için bozuk (şifresiz) kayıt silindi. Yeniden bağlayabilirsiniz.` };
    return { ok: true, message: `${label} bağlantısı kesildi.` };
  } catch (e) {
    return failure(e, "Bağlantı kesilemedi; lütfen tekrar deneyin.");
  }
}
