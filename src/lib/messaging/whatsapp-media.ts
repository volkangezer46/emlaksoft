import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { discardExternalResponse, fetchExternal, readExternalJson } from "@/lib/external-fetch";
import { getTenantWhatsAppGraphAccess } from "@/lib/messaging/tenant-providers";
import {
  INBOUND_MEDIA_BUCKET,
  INBOUND_MEDIA_MAX_BYTES,
  inboundMediaPath,
  isAllowedMetaMediaUrl,
  normalizeInboundMime,
  type InboundMediaRecord,
} from "@/lib/messaging/whatsapp-media-rules";

/**
 * Gelen WhatsApp medyasını kalıcılaştırma (COM-03). Meta'nın medya adresi ~5 dk geçerlidir; webhook işlenirken:
 *   1. Graph `GET /{media-id}` (ofisin KENDİ anahtarıyla) → geçici URL + MIME + boyut,
 *   2. URL yalnız Meta medya alan adındaysa (SSRF), MIME izinliyse ve boyut ≤ 16 MB ise indirilir (bayt sınırlı okuma),
 *   3. ÖZEL `inbound-media` kovasına `<ofis>/<yyyy>/<mm>/<iletişim>/<dosya>` yoluna yazılır.
 * ASLA fırlatmaz: hata kodu döner ve çağıran mesajı metin özetiyle saklamaya devam eder. Yönlendirme izlenmez
 * (fetchExternal), anahtar yalnız Authorization başlığındadır.
 */

const GRAPH_TIMEOUT_MS = 8_000;
const DOWNLOAD_TIMEOUT_MS = 20_000;
const MEDIA_ID_RE = /^\d{1,32}$/;

export type StoreInboundMediaResult =
  | { ok: true; media: InboundMediaRecord }
  | { ok: false; code: string };

async function readBytesLimited(response: Response, maxBytes: number): Promise<Uint8Array | null> {
  const declared = response.headers.get("content-length");
  if (declared && /^\d+$/.test(declared) && Number(declared) > maxBytes) {
    await discardExternalResponse(response);
    return null;
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

export async function storeInboundWhatsAppMedia(
  admin: SupabaseClient,
  input: {
    tenantId: string;
    communicationId: string;
    mediaId: string;
    kind: string;
    declaredMime?: string | null;
    filename?: string | null;
    receivedAt: Date;
  },
): Promise<StoreInboundMediaResult> {
  try {
    if (!MEDIA_ID_RE.test(input.mediaId)) return { ok: false, code: "invalid_media_id" };
    const access = await getTenantWhatsAppGraphAccess(input.tenantId);
    if (!access) return { ok: false, code: "tenant_provider_unconfigured" };

    const metaRes = await fetchExternal(
      `https://graph.facebook.com/${access.graphVersion}/${encodeURIComponent(input.mediaId)}`,
      { method: "GET", headers: { Authorization: `Bearer ${access.token}` } },
      { timeoutMs: GRAPH_TIMEOUT_MS },
    );
    if (!metaRes.ok) {
      await discardExternalResponse(metaRes);
      return { ok: false, code: `graph_http_${metaRes.status}` };
    }
    const meta = await readExternalJson<{ url?: unknown; mime_type?: unknown; file_size?: unknown }>(metaRes, 16 * 1024);
    const url = typeof meta.url === "string" ? meta.url : "";
    if (!isAllowedMetaMediaUrl(url)) return { ok: false, code: "media_url_not_allowed" };
    const mime = normalizeInboundMime(typeof meta.mime_type === "string" ? meta.mime_type : input.declaredMime);
    if (!mime) return { ok: false, code: "media_mime_not_allowed" };
    const declaredSize = Number(meta.file_size);
    if (Number.isFinite(declaredSize) && declaredSize > INBOUND_MEDIA_MAX_BYTES) return { ok: false, code: "media_too_large" };

    const fileRes = await fetchExternal(
      url,
      { method: "GET", headers: { Authorization: `Bearer ${access.token}` } },
      { timeoutMs: DOWNLOAD_TIMEOUT_MS },
    );
    if (!fileRes.ok) {
      await discardExternalResponse(fileRes);
      return { ok: false, code: `media_http_${fileRes.status}` };
    }
    const bytes = await readBytesLimited(fileRes, INBOUND_MEDIA_MAX_BYTES);
    if (!bytes) return { ok: false, code: "media_too_large" };
    if (bytes.byteLength === 0) return { ok: false, code: "media_empty" };

    const path = inboundMediaPath({
      tenantId: input.tenantId,
      communicationId: input.communicationId,
      mime,
      filename: input.filename ?? null,
      at: input.receivedAt,
    });
    const { error } = await admin.storage.from(INBOUND_MEDIA_BUCKET).upload(path, bytes, {
      contentType: mime,
      upsert: true,
    });
    if (error) return { ok: false, code: "storage_upload_failed" };
    return {
      ok: true,
      media: {
        path,
        mime,
        size: bytes.byteLength,
        kind: input.kind,
        filename: input.filename ? input.filename.slice(0, 200) : null,
      },
    };
  } catch {
    return { ok: false, code: "media_fetch_failed" };
  }
}

/**
 * Panelde önizleme için kısa ömürlü imzalı URL. Yol MUTLAKA çağıranın kiracı önekini taşımalıdır (başka ofisin
 * dosyası imzalanmaz); iletişim satırı çağıranda RLS'li istemciyle okunmuş olmalıdır.
 */
export async function signInboundMediaUrl(
  admin: SupabaseClient,
  tenantId: string,
  path: string,
  expiresInSec = 300,
): Promise<string | null> {
  if (!path.startsWith(`${tenantId}/`) || path.includes("..")) return null;
  const { data, error } = await admin.storage.from(INBOUND_MEDIA_BUCKET).createSignedUrl(path, expiresInSec);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}
