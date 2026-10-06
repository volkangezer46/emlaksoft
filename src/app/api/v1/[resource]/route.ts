import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { hashApiKey, isApiResource, parseBearerKey } from "@/lib/integrations-api/core";

export const dynamic = "force-dynamic";

function json(body: unknown, status: number, headers?: Record<string, string>) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers } });
}

/**
 * GET /api/v1/{properties|customers|deals}?limit=50&before=<ISO>
 * Kimlik: `Authorization: Bearer es_...` (ofisin Ayarlar > API ve webhook ekranında oluşturduğu anahtar).
 * Doğrulama ve okuma TEK RPC'de (`api_v1_list`, DEFINER): anahtarın sha256 özeti eşleşmeli, iptal edilmemiş ve kapsamda
 * olmalı; örnek veri ve silinmiş kayıt dönmez; en çok 100 satır. Anahtar başına dakikada 60 istek.
 * service_role KULLANILMAZ.
 */
export async function GET(req: Request, { params }: { params: Promise<{ resource: string }> }) {
  const { resource } = await params;
  if (!isApiResource(resource)) return json({ error: "Bilinmeyen kaynak." }, 404);
  const key = parseBearerKey(req.headers.get("authorization"));
  if (!key) return json({ error: "Geçerli bir API anahtarı gerekli (Authorization: Bearer ...)." }, 401, { "WWW-Authenticate": "Bearer" });

  const keyHash = hashApiKey(key);
  const limit = await checkRateLimit(`api-v1:${keyHash.slice(0, 32)}`, { limit: 60, windowSec: 60, failurePolicy: "deny" });
  if (!limit.allowed) return json({ error: "Çok fazla istek." }, 429, { "Retry-After": "60" });

  const url = new URL(req.url);
  const limitParam = Number(url.searchParams.get("limit") ?? "50");
  const beforeRaw = url.searchParams.get("before");
  const before = beforeRaw && !Number.isNaN(Date.parse(beforeRaw)) ? new Date(beforeRaw).toISOString() : null;

  const db = await createClient();
  const { data, error } = await db.rpc("api_v1_list", {
    p_key_hash: keyHash,
    p_resource: resource,
    p_limit: Number.isFinite(limitParam) ? Math.trunc(limitParam) : 50,
    p_before: before,
  });
  if (error) {
    const missing = error.code === "PGRST202" || error.code === "42883";
    return json({ error: missing ? "API henüz etkin değil." : "Sorgu başarısız." }, missing ? 503 : 500);
  }
  const res = (data ?? {}) as { ok?: boolean; code?: string; data?: unknown[] };
  if (!res.ok) {
    const status = res.code === "forbidden" ? 403 : res.code === "not_found" ? 404 : 401;
    return json({ error: status === 403 ? "Bu anahtarın bu kaynağa erişimi yok." : status === 404 ? "Bilinmeyen kaynak." : "Geçersiz veya iptal edilmiş anahtar." }, status);
  }
  const rows = Array.isArray(res.data) ? res.data : [];
  const last = rows.length > 0 ? (rows[rows.length - 1] as { created_at?: string }).created_at ?? null : null;
  return json({ data: rows, next_before: rows.length > 0 ? last : null }, 200);
}
