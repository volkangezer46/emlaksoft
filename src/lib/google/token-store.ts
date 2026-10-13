import { openPlatformSecret } from "@/lib/platform-secrets";
import { requireSealed, sealSecret, secretFingerprint, secretsWritable } from "@/lib/settings/secrets";
import { GOOGLE_KEYS, tokenKeyOf, type GoogleService } from "./keys";

/**
 * `google.*` platform_settings deposu. Her değer JSON'dur ve MÜHÜRLÜ yazılır (`sealSecret`, AAD = anahtar adı).
 *  - Mühürleme anahtarı yoksa YAZILMAZ (düz metin asla yazılmaz) → bağlama reddedilir.
 *  - Okumada düz metin değer `requireSealed` ile REDDEDİLİR (geçiş dönemi istisnası bu ailede yok).
 *  - Açılamayan (anahtar döndürülmüş/bozuk) değer "yok" sayılır; durum ekranı "yeniden bağla" gösterir.
 * Depo erişimi `SettingsPort` ile soyutlanır (testte bellek içi sahte depo); üretim portu `db.ts`'tedir.
 */

export type SettingsPort = {
  read(keys: readonly string[]): Promise<Record<string, string | null>>;
  write(key: string, sealed: string, meta: { actorId: string | null; fingerprint: string; summary: string }): Promise<boolean>;
  remove(key: string, meta: { actorId: string | null }): Promise<boolean>;
};

export type OAuthClientConfig = { clientId: string; clientSecret: string };

export type TokenRecord = {
  refreshToken: string;
  scope: string;
  connectedAt: string;
  connectedBy: string | null;
  /** invalid_grant sonrası: kullanıcı yeniden bağlamalı. */
  needsReconnect?: boolean;
  lastSyncAt?: string | null;
  lastError?: string | null;
};

export type AdsAccountConfig = { customerId: string; loginCustomerId: string | null; developerToken: string; apiVersion?: string | null };
export type GscPropertyConfig = { siteUrl: string };
export type QuotaRecord = { day: string; used: number };

export class GoogleSecretsUnavailableError extends Error {
  constructor() {
    super("Şifreleme anahtarı tanımlı değil; Google bilgileri düz metin olarak YAZILMAZ.");
    this.name = "GoogleSecretsUnavailableError";
  }
}

/** Mühürlü JSON okur. Düz metin → fırlatır; açılamazsa/bozuksa → null. */
export function openSealedJson<T>(key: string, raw: string | null | undefined): T | null {
  const sealed = requireSealed(raw);
  if (!sealed) return null;
  const plain = openPlatformSecret(key, sealed);
  if (!plain) return null;
  try {
    return JSON.parse(plain) as T;
  } catch {
    return null;
  }
}

export function sealJson(key: string, value: unknown): { sealed: string; fingerprint: string } {
  if (!secretsWritable()) throw new GoogleSecretsUnavailableError();
  const plain = JSON.stringify(value);
  const sealed = sealSecret(key, plain);
  if (!sealed) throw new GoogleSecretsUnavailableError();
  return { sealed, fingerprint: secretFingerprint(key, plain) };
}

export type GoogleStoreSnapshot = {
  client: OAuthClientConfig | null;
  tokens: Record<GoogleService, TokenRecord | null>;
  adsAccount: AdsAccountConfig | null;
  gscProperty: GscPropertyConfig | null;
  /** Okuma sırasında düz metin ya da açılamayan değer bulunan anahtarlar (ekranda uyarı). */
  problems: string[];
};

const SNAPSHOT_KEYS = [GOOGLE_KEYS.client, GOOGLE_KEYS.gsc, GOOGLE_KEYS.ads, GOOGLE_KEYS.adsAccount, GOOGLE_KEYS.gscProperty] as const;

/** Tek sorguda tüm bağlantı kayıtları. Düz metin değer o alanı null yapar ve `problems`e yazılır (fırlatmaz). */
export async function readGoogleSnapshot(port: SettingsPort): Promise<GoogleStoreSnapshot> {
  const raw = await port.read(SNAPSHOT_KEYS);
  const problems: string[] = [];
  const open = <T>(key: string): T | null => {
    try {
      const v = openSealedJson<T>(key, raw[key]);
      if (v === null && raw[key]) problems.push(key);
      return v;
    } catch {
      problems.push(key);
      return null;
    }
  };
  return {
    client: open<OAuthClientConfig>(GOOGLE_KEYS.client),
    tokens: { gsc: open<TokenRecord>(GOOGLE_KEYS.gsc), ads: open<TokenRecord>(GOOGLE_KEYS.ads) },
    adsAccount: open<AdsAccountConfig>(GOOGLE_KEYS.adsAccount),
    gscProperty: open<GscPropertyConfig>(GOOGLE_KEYS.gscProperty),
    problems,
  };
}

/** Sıkı tek kayıt okuması: düz metinde FIRLATIR (sözleşme). */
export async function readSealed<T>(port: SettingsPort, key: string): Promise<T | null> {
  const raw = await port.read([key]);
  return openSealedJson<T>(key, raw[key]);
}

export async function writeSealed(
  port: SettingsPort,
  key: string,
  value: unknown,
  actorId: string | null,
  summary: string,
): Promise<boolean> {
  const { sealed, fingerprint } = sealJson(key, value);
  return port.write(key, sealed, { actorId, fingerprint, summary });
}

export async function saveToken(port: SettingsPort, service: GoogleService, record: TokenRecord, actorId: string | null) {
  return writeSealed(port, tokenKeyOf(service), record, actorId, "bağlandı");
}

export async function readToken(port: SettingsPort, service: GoogleService): Promise<TokenRecord | null> {
  return readSealed<TokenRecord>(port, tokenKeyOf(service));
}

/** Toplayıcı/cron: durum alanlarını günceller (belirteç aynı kalır). Kayıt yoksa bir şey yapmaz. */
export async function patchToken(
  port: SettingsPort,
  service: GoogleService,
  patch: Partial<Pick<TokenRecord, "needsReconnect" | "lastSyncAt" | "lastError">>,
): Promise<boolean> {
  const current = await readToken(port, service);
  if (!current) return false;
  return writeSealed(port, tokenKeyOf(service), { ...current, ...patch }, null, "durum güncellendi");
}

export async function removeToken(port: SettingsPort, service: GoogleService, actorId: string | null): Promise<boolean> {
  return port.remove(tokenKeyOf(service), { actorId });
}
