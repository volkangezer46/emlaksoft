"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { checkRateLimit } from "@/lib/rate-limit";
import { now as clockNow } from "@/lib/clock";
import { actionErrorMessage } from "@/lib/action-errors";
import { isMissingSchema } from "@/lib/listing-control/server/db";
import { generateTransferCode, hashPayloadSource, hashTransferCode, TRANSFER_CODE_TTL_MIN } from "@/lib/portal-transfer/code";
import { buildPortalPayload, payloadFingerprintSource, readinessCheck, type Readiness } from "@/lib/portal-transfer/payload";
import { loadPropertyForTransfer } from "@/lib/portal-transfer/server";
import { PORTAL_FORM_RULES, isTransferPortal } from "@/lib/portal-transfer/rules";
import { isPortalActive } from "@/lib/portals/membership";

/**
 * "Portala aktar" (dışa aktarım) — oturum hazırlama. Sunucu portala istek ATMAZ ve ilan YAYINLAMAZ: yalnız tek kullanımlık,
 * kısa ömürlü bir aktarım kodu üretir (kod özeti `portal_transfer_sessions`'a yazılır, ham kod yazılmaz). Eklenti paketi bu kodla
 * aynı kökenli uçtan alır, kullanıcının KENDİ portal sekmesinde formu doldurur; "Yayınla"ya kullanıcı basar.
 * Kapı: `portals:edit`; satır kapsamı ve kiracı sınırı `pt_prepare_session` RPC'sinde (JWT; service_role YOK).
 */

export type PrepareTransferResult =
  | {
      ok: true;
      code: string;
      sessionId: string;
      portal: string;
      portalLabel: string;
      newListingUrl: string;
      expiresAt: string;
      ttlMinutes: number;
      readiness: Readiness;
      summary: { fields: number; photos: number; photosTrimmed: number };
    }
  | { ok: false; error: string };

const idSchema = z.string().uuid();

const PREPARE_ERRORS: Record<string, string> = {
  forbidden: "Bu işlem için yetkiniz yok.",
  invalid_input: "Geçersiz istek.",
  property_not_found: "Portföy bulunamadı ya da size açık değil.",
  property_closed: "Satılmış, kiralanmış ya da arşivlenmiş portföy portala aktarılamaz.",
};

export async function preparePortalTransfer(propertyId: string, portal: string): Promise<PrepareTransferResult> {
  const gate = await requirePermission("portals", "edit");
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!idSchema.safeParse(propertyId).success || !isTransferPortal(portal)) return { ok: false, error: "Portföy ve portal seçin." };
  const limit = await checkRateLimit(`pt-prepare:${gate.userId}`, { limit: 30, windowSec: 60, failurePolicy: "deny" });
  if (!limit.allowed) return { ok: false, error: "Çok sık denediniz; bir dakika sonra tekrar deneyin." };
  // Üyelik sunucuda da denetlenir (arayüz üye olunmayan portalda düğme göstermez; eski sekme/doğrudan çağrı kod üretmesin).
  if (!(await isPortalActive(gate.tenantId, portal))) {
    return { ok: false, error: "Ofis bu portala üye görünmüyor; Ayarlar > Entegrasyonlar > Portal üyelikleri kartından ekleyin." };
  }

  const db = await createClient();
  const input = await loadPropertyForTransfer(db, gate.tenantId, propertyId);
  if (!input) return { ok: false, error: PREPARE_ERRORS.property_not_found! };
  const payload = buildPortalPayload(input, portal, clockNow());
  const readiness = readinessCheck(payload);

  const code = generateTransferCode();
  const { data, error } = await db.rpc("pt_prepare_session", {
    p_property_id: propertyId,
    p_portal: portal,
    p_direction: "export",
    p_code_hash: hashTransferCode(code),
    p_payload_hash: hashPayloadSource(payloadFingerprintSource(payload)),
    p_missing: readiness.missing.map((m) => String(m.key)),
    p_ttl_minutes: TRANSFER_CODE_TTL_MIN,
  });
  if (error) {
    console.error("pt_prepare_session", { code: error.code });
    return { ok: false, error: isMissingSchema(error) ? "Portala aktarma için sistem güncellemesi bekleniyor." : actionErrorMessage(error, "Aktarım başlatılamadı.") };
  }
  const r = (data ?? {}) as { outcome?: string; session_id?: string; expires_at?: string };
  if (r.outcome !== "ok" || !r.session_id) return { ok: false, error: PREPARE_ERRORS[String(r.outcome)] ?? actionErrorMessage(null, "Aktarım başlatılamadı.") };

  revalidatePath(`/app/portfoyler/${propertyId}`);
  const rules = PORTAL_FORM_RULES[portal];
  return {
    ok: true,
    code,
    sessionId: r.session_id,
    portal,
    portalLabel: rules.label,
    newListingUrl: rules.newListingUrl,
    expiresAt: r.expires_at ?? "",
    ttlMinutes: TRANSFER_CODE_TTL_MIN,
    readiness,
    summary: { fields: Object.keys(payload.fields).length, photos: payload.photos.length, photosTrimmed: payload.photosTrimmed },
  };
}
