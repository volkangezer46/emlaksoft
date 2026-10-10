/**
 * e-Fatura kimlik bilgisi saklama: mevcut `platform-secrets` şifrelemesi (AES-256-GCM) ile.
 * AAD (ayar anahtarı) = `einvoice:<tenant>:<provider>` -> başka ofisin/sağlayıcının kaydına taşınan şifreli metin çözülmez.
 * Şifreleme anahtarı yoksa `sealEInvoiceCredentials` null döner; çağıran KAYDETMEZ (düz metin ASLA yazılmaz).
 * Anahtar değeri ekrana geri verilmez: yalnız geri döndürülemez kısa parmak izi gösterilir.
 */
import { createHash } from "node:crypto";
import { openPlatformSecret, sealPlatformSecret } from "@/lib/platform-secrets";
import type { NilveraCredentials } from "./nilvera";
import type { ParasutCredentials } from "./parasut";
import type { EInvoiceProviderId } from "./types";

export type EInvoiceCredentials =
  | ({ provider: "nilvera" } & NilveraCredentials)
  | ({ provider: "parasut" } & ParasutCredentials);

export function einvoiceSecretKey(tenantId: string, provider: EInvoiceProviderId): string {
  return `einvoice:${tenantId}:${provider}`;
}

export function sealEInvoiceCredentials(tenantId: string, creds: EInvoiceCredentials): string | null {
  return sealPlatformSecret(einvoiceSecretKey(tenantId, creds.provider), JSON.stringify(creds));
}

function nonEmpty(v: unknown, min = 1, max = 2000): v is string {
  return typeof v === "string" && v.length >= min && v.length <= max && v === v.trim();
}

export function openEInvoiceCredentials(
  tenantId: string,
  provider: EInvoiceProviderId,
  sealed: string | null | undefined,
): EInvoiceCredentials | null {
  const plain = openPlatformSecret(einvoiceSecretKey(tenantId, provider), sealed);
  if (!plain) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(plain);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  if (obj.provider !== provider) return null;
  if (provider === "nilvera") {
    return nonEmpty(obj.apiKey, 10) ? { provider, apiKey: obj.apiKey } : null;
  }
  if (nonEmpty(obj.clientId) && nonEmpty(obj.clientSecret) && nonEmpty(obj.companyId) && nonEmpty(obj.refreshToken)) {
    return { provider, clientId: obj.clientId, clientSecret: obj.clientSecret, companyId: obj.companyId, refreshToken: obj.refreshToken };
  }
  return null;
}

/** Geri döndürülemez, ekranda gösterilebilir kısa parmak izi (anahtarın kendisi değil). */
export function secretFingerprint(secret: string): string {
  return createHash("sha256").update(secret).digest("hex").slice(0, 8);
}

export function credentialFingerprint(creds: EInvoiceCredentials): string {
  return secretFingerprint(creds.provider === "nilvera" ? creds.apiKey : `${creds.clientId}:${creds.companyId}`);
}

/** Giriş doğrulaması (biçim); mesajlar Türkçe ve anahtar içermez. */
export function parseNilveraInput(apiKey: string): { ok: true; value: { provider: "nilvera"; apiKey: string } } | { ok: false; error: string } {
  const key = apiKey.trim();
  if (key.length < 10 || key.length > 2000 || /\s/.test(key)) {
    return { ok: false, error: "API anahtarı geçerli görünmüyor. Nilvera panelinden kopyaladığınız anahtarı boşluksuz yapıştırın." };
  }
  return { ok: true, value: { provider: "nilvera", apiKey: key } };
}

export function parseParasutInput(input: {
  clientId: string;
  clientSecret: string;
  companyId: string;
  email: string;
  password: string;
}): { ok: true } | { ok: false; error: string } {
  if (!input.clientId.trim() || !input.clientSecret.trim()) return { ok: false, error: "Paraşüt istemci kimliği ve sırrı gerekli." };
  if (!/^\d{1,12}$/.test(input.companyId.trim())) return { ok: false, error: "Firma numarası yalnız rakamlardan oluşmalı." };
  if (!input.email.trim() || !input.password) return { ok: false, error: "Paraşüt e-postası ve parolası gerekli (parola kaydedilmez)." };
  return { ok: true };
}
