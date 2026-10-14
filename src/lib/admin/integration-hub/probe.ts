import "server-only";
import { access } from "node:fs/promises";
import path from "node:path";
import { now, daysAgoIso } from "@/lib/clock";
import { externalErrorMetadata } from "@/lib/external-fetch";
import { getIyzicoConfig, probeIyzicoCredentials } from "@/lib/billing/iyzico";
import { getNetgsmConfig, getWhatsAppConfig, probeNetgsmCredentials, probeWhatsAppConfig } from "@/lib/messaging/netgsm";
import { testResendConnection } from "@/lib/email/test-send";
import { getOpenAiKey } from "@/lib/ai-advisor";
import { probeOpenAiKey, type OpenAiErrorKind } from "@/lib/ai/openai-client";
import { evdsApiKey, evdsSeries, fetchEvdsSeries } from "@/lib/evds";
import { probeEmlakFiyatiConnection, type EmlakFiyatiProbeState } from "@/lib/integrations/emlakfiyati/adapter";
import { platformSettingsPort } from "@/lib/google/db";
import { probeAdsAccount } from "@/lib/google/ads";
import { listSites } from "@/lib/google/gsc";
import { GoogleApiError, isInvalidGrant } from "@/lib/google/http";
import { refreshAccessToken } from "@/lib/google/oauth";
import { GoogleSecretsUnavailableError, patchToken, readGoogleSnapshot } from "@/lib/google/token-store";
import { EXTENSION_PACKAGE_DIR, extensionZipFileName } from "@/lib/listing-control/worker/extension-release";
import { validateVapidPair, type HubKey } from "./model";

/**
 * "Test et" yoklamaları (sunucu). Her biri GERÇEK ama ZARARSIZ bir çağrıdır: ödeme/SMS/e-posta/bildirim GÖNDERMEZ, kayıt
 * DEĞİŞTİRMEZ (Google'da yalnız geri çekilmiş belirteç "yeniden bağla" olarak işaretlenir; EmlakFiyati başarıda kendi
 * "son başarılı çağrı" damgasını yazar). Sonuç metni sağlayıcı gövdesini/anahtarı İÇERMEZ (yalnız sınıf ve kısa açıklama).
 */

export type ProbeOutcome = { ok: boolean; message: string; code: string | null; durationMs: number };

type Raw = { ok: boolean; message: string; code?: string | null };

const OPENAI_KIND_TEXT: Record<OpenAiErrorKind, string> = {
  auth: "OpenAI anahtarı reddedildi (yetkisiz).",
  rate_limit: "OpenAI hız sınırına takıldı; birazdan tekrar deneyin.",
  bad_request: "OpenAI isteği reddetti.",
  server: "OpenAI sunucu hatası verdi.",
  timeout: "OpenAI zamanında yanıt vermedi.",
  aborted: "İstek iptal edildi.",
  request_too_large: "İstek çok büyük.",
  response_too_large: "Yanıt beklenenden büyük.",
  invalid_response: "OpenAI yanıtı okunamadı.",
  network: "OpenAI'ye bağlanılamadı.",
};

const EF_STATE_TEXT: Record<EmlakFiyatiProbeState, string> = {
  connected: "EmlakFiyati endeksi okundu.",
  auth: "EmlakFiyati anahtarı reddedildi (401).",
  forbidden: "EmlakFiyati erişimi yasakladı (403).",
  rate_limited: "EmlakFiyati hız sınırına takıldı.",
  network: "EmlakFiyati'ye bağlanılamadı.",
  server: "EmlakFiyati sunucu hatası verdi.",
  disabled: "EmlakFiyati anahtarı tanımlı değil.",
};

function googleFailure(e: unknown): Raw {
  if (e instanceof GoogleSecretsUnavailableError) return { ok: false, code: "secrets_off", message: "Şifreleme anahtarı yok; Google kaydı açılamadı." };
  if (isInvalidGrant(e)) return { ok: false, code: "invalid_grant", message: "Google erişimi geri çekmiş; hizmeti yeniden bağlayın." };
  if (e instanceof GoogleApiError) return { ok: false, code: `http_${e.status}`, message: `Google yanıtı: ${e.status}${e.code ? ` (${String(e.code).slice(0, 40)})` : ""}.` };
  return { ok: false, code: "network", message: "Google'a bağlanılamadı." };
}

async function probeGoogle(service: "gsc" | "ads"): Promise<Raw> {
  try {
    const snap = await readGoogleSnapshot(platformSettingsPort);
    const token = snap.tokens[service];
    if (!snap.client || !token) return { ok: false, code: "not_connected", message: "Hizmet bağlı değil." };
    try {
      const access = await refreshAccessToken({ client: snap.client, refreshToken: token.refreshToken });
      if (service === "gsc") {
        const sites = await listSites(access);
        return { ok: true, message: `Search Console'a erişildi: ${sites.length} mülk.` };
      }
      if (!snap.adsAccount) return { ok: false, code: "no_account", message: "Ads hesabı girilmedi." };
      const info = await probeAdsAccount({ ...snap.adsAccount, accessToken: access });
      return { ok: true, message: `Ads hesabına erişildi${info.name ? `: ${info.name.slice(0, 60)}` : ""}.` };
    } catch (e) {
      if (isInvalidGrant(e)) await patchToken(platformSettingsPort, service, { needsReconnect: true, lastError: "invalid_grant" }).catch(() => false);
      return googleFailure(e);
    }
  } catch (e) {
    return googleFailure(e);
  }
}

async function run(key: HubKey): Promise<Raw> {
  switch (key) {
    case "iyzico": {
      if (!getIyzicoConfig()) return { ok: false, code: "not_configured", message: "iyzico anahtarları sunucu ortamında tanımlı değil." };
      try {
        const r = await probeIyzicoCredentials();
        return r.ok
          ? { ok: true, message: "iyzico imzalı isteği kabul etti." }
          : { ok: false, code: r.errorCode, message: `iyzico isteği reddetti${r.errorCode ? ` (kod ${r.errorCode})` : ""}${r.errorMessage ? `: ${r.errorMessage}` : ""}.` };
      } catch (e) {
        const meta = externalErrorMetadata(e);
        return { ok: false, code: meta.kind, message: meta.kind === "http" ? `iyzico HTTP ${meta.status ?? "?"} döndürdü.` : "iyzico'ya bağlanılamadı." };
      }
    }
    case "netgsm": {
      const cfg = await getNetgsmConfig();
      if (!cfg) return { ok: false, code: "not_configured", message: "Netgsm kullanıcı kodu, parola ve başlık tanımlı değil." };
      const r = await probeNetgsmCredentials(cfg);
      return { ok: r.ok, code: r.code, message: r.ok && r.credit ? `Kalan kredi: ${r.credit}` : r.message };
    }
    case "resend": {
      const r = await testResendConnection();
      if (!r.ok) return { ok: false, code: "failed", message: r.error.slice(0, 200) };
      const domain = r.fromDomain ? ` Gönderen alan adı ${r.fromDomain}: ${r.fromDomainVerified ? "doğrulanmış" : "doğrulanmamış"}.` : "";
      return { ok: true, message: `Resend'e erişildi (${r.domains.length} alan adı).${domain}` };
    }
    case "whatsapp": {
      const cfg = await getWhatsAppConfig();
      if (!cfg) return { ok: false, code: "not_configured", message: "WhatsApp API adresi ve belirteci tanımlı değil." };
      const r = await probeWhatsAppConfig(cfg);
      return { ok: r.ok, code: r.code, message: r.message };
    }
    case "google_gsc":
      return probeGoogle("gsc");
    case "google_ads":
      return probeGoogle("ads");
    case "openai": {
      const apiKey = await getOpenAiKey();
      if (!apiKey) return { ok: false, code: "not_configured", message: "OpenAI anahtarı tanımlı değil." };
      const r = await probeOpenAiKey(apiKey);
      return r.ok ? { ok: true, message: `OpenAI anahtarı geçerli (${r.models} model erişilebilir).` } : { ok: false, code: r.kind, message: OPENAI_KIND_TEXT[r.kind] };
    }
    case "evds": {
      if (!evdsApiKey()) return { ok: false, code: "not_configured", message: "EVDS_API_KEY tanımlı değil." };
      const today = daysAgoIso(0).slice(0, 10);
      const points = await fetchEvdsSeries(evdsSeries().cpi, daysAgoIso(62).slice(0, 10), today);
      return points && points.length > 0
        ? { ok: true, message: `EVDS TÜFE serisi okundu (${points.length} nokta).` }
        : { ok: false, code: "no_data", message: "EVDS yanıt vermedi ya da seri boş döndü (anahtar/seri kodunu kontrol edin)." };
    }
    case "vapid": {
      const r = validateVapidPair(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
      return { ok: r.ok, code: r.ok ? null : "invalid", message: r.message };
    }
    case "emlakfiyati": {
      const { state } = await probeEmlakFiyatiConnection();
      return { ok: state === "connected", code: state, message: EF_STATE_TEXT[state] };
    }
    case "portal_extension": {
      const file = extensionZipFileName();
      try {
        await access(path.join(process.cwd(), EXTENSION_PACKAGE_DIR, file));
        return { ok: true, message: `İndirme paketi hazır (${file}).` };
      } catch {
        return { ok: false, code: "package_missing", message: `İndirme paketi sunucuda yok (${file}); eklenti derleme betiğini çalıştırın.` };
      }
    }
    case "portal_api":
      return { ok: false, code: "unsupported", message: "Kurumsal portal API'leri için zararsız test uç noktası tanımlı değil." };
  }
}

export async function runIntegrationProbe(key: HubKey): Promise<ProbeOutcome> {
  const started = now();
  let raw: Raw;
  try {
    raw = await run(key);
  } catch {
    raw = { ok: false, code: "unexpected", message: "Test beklenmedik biçimde sonuçlandı." };
  }
  return { ok: raw.ok, message: raw.message.slice(0, 240), code: raw.code ?? null, durationMs: Math.max(0, now() - started) };
}
