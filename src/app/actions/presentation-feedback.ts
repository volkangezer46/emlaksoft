"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { notifyTenant } from "@/lib/notify";
import { isPublicTenantActive } from "@/lib/public-tenant";
import { isPublicFeatureClosed } from "@/lib/modules/public";
import { now, trDayKey, trParts } from "@/lib/clock";
import {
  isMissingFeedbackTable,
  isPresentationFeedbackVerdict,
  normalizeFeedbackNote,
  noteTooLong,
  PRESENTATION_FEEDBACK_NOTE_MAX,
  presentationFeedbackDedupeKey,
  presentationFeedbackHref,
  presentationFeedbackNotification,
  type PresentationFeedbackVerdict,
} from "@/lib/presentation-feedback";

export type PresentationFeedbackResult =
  | { ok: true; verdict: PresentationFeedbackVerdict; note: string | null }
  | { ok: false; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INVALID = "Bu sunum bağlantısı artık geçerli değil.";

/**
 * Sunumda ilan bazında müşteri geri bildirimi (İlgileniyorum / İlgilenmiyorum + not) — /sunum/[token].
 *
 * NEDEN service_role: müşteri oturum açmaz (likePublicShare / submitMatchFeedbackByToken deseni). Koruma:
 * UUID ön eleme + honeypot + IP+token hız sınırı (deny) + token tek sunuma çözülür; ilan sunumun property_ids
 * listesinde OLMALI; ofis aktif, sunum modülü açık; örnek/silinmiş/taslak ilan reddedilir. tenant_id ve
 * customer_id kullanıcıdan alınmaz, sunumdan gelir.
 *
 * Kayıt `presentation_feedback`'e upsert edilir (müşteri fikrini değiştirebilir; ilan başına tek satır), sunumu
 * hazırlayan danışmana bildirim düşer (aynı seçim + aynı not tekrar gönderilirse bildirim yok; gidip gelen seçimler
 * ilan + seçim + TR saati dedupe_key'iyle saatte en çok iki bildirime iner). Tablo henüz yoksa
 * (migration uygulanmadı) bildirim yine gider — geri bildirim danışmana ulaştığı için başarı dürüsttür; ikisi de
 * olmazsa hata döner.
 */
export async function submitPresentationFeedback(input: {
  token: string;
  propertyId: string;
  verdict: string;
  note?: string | null;
  /** Honeypot — botlar doldurur, gerçek kullanıcı görmez. */
  website?: string;
}): Promise<PresentationFeedbackResult> {
  const token = String(input?.token ?? "").trim();
  const propertyId = String(input?.propertyId ?? "").trim();
  if (!UUID_RE.test(token) || !UUID_RE.test(propertyId)) return { ok: false, error: INVALID };
  if (!isPresentationFeedbackVerdict(input.verdict)) return { ok: false, error: "Geçersiz seçim." };
  const verdict = input.verdict;
  const note = normalizeFeedbackNote(input.note);
  if (noteTooLong(note)) return { ok: false, error: `Not en fazla ${PRESENTATION_FEEDBACK_NOTE_MAX} karakter olabilir.` };
  if (String(input.website ?? "").trim()) return { ok: true, verdict, note };

  const ip = await clientIp();
  const { allowed } = await checkRateLimit(`presentation-feedback:${ip}:${token.slice(0, 24)}`, {
    limit: 30,
    windowSec: 3600,
    failurePolicy: "deny",
  });
  if (!allowed) return { ok: false, error: "Çok fazla deneme yapıldı. Lütfen biraz sonra tekrar deneyin." };

  const admin = createAdminClient();
  const { data: pres } = await admin
    .from("presentations")
    .select("id, tenant_id, title, property_ids, customer_id, customer_name, created_by, tenant:tenants(status)")
    .eq("public_token", token)
    .maybeSingle();
  const tenantRel = pres?.tenant as { status?: string } | { status?: string }[] | null | undefined;
  const tenant = Array.isArray(tenantRel) ? tenantRel[0] : tenantRel;
  if (!pres || !tenant || !isPublicTenantActive(tenant.status)) return { ok: false, error: INVALID };
  if (!((pres.property_ids ?? []) as string[]).includes(propertyId)) return { ok: false, error: "Bu portföy sunumda yok." };

  const tenantId = pres.tenant_id as string;
  const [closed, { data: property }, existingRes, { data: creator }] = await Promise.all([
    isPublicFeatureClosed(admin, tenantId, "presentations"),
    admin
      .from("properties")
      .select("id, title, property_code, status")
      .eq("id", propertyId)
      .eq("tenant_id", tenantId)
      .eq("is_sample", false)
      .is("deleted_at", null)
      .maybeSingle(),
    admin
      .from("presentation_feedback")
      .select("verdict, note")
      .eq("presentation_id", pres.id)
      .eq("property_id", propertyId)
      .maybeSingle(),
    pres.created_by
      ? admin
          .from("profiles")
          .select("id")
          .eq("id", pres.created_by)
          .eq("tenant_id", tenantId)
          .eq("is_active", true)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (closed) return { ok: false, error: INVALID };
  if (!property || property.status === "draft") return { ok: false, error: "Bu portföy artık sunumda gösterilmiyor." };

  const existing = existingRes.error ? null : (existingRes.data as { verdict: string; note: string | null } | null);
  // Aynı seçim + aynı not: iş yok (bildirim spam'i de önlenir).
  if (existing && existing.verdict === verdict && (existing.note ?? null) === note) return { ok: true, verdict, note };

  const customerId = (pres.customer_id as string | null) ?? null;
  const { error: upsertError } = await admin.from("presentation_feedback").upsert(
    {
      tenant_id: tenantId,
      presentation_id: pres.id,
      property_id: propertyId,
      customer_id: customerId,
      verdict,
      note,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "presentation_id,property_id" },
  );
  const stored = !upsertError;
  if (upsertError && !isMissingFeedbackTable(upsertError)) {
    console.error("submitPresentationFeedback upsert", upsertError.message);
  }

  const message = presentationFeedbackNotification({
    verdict,
    customerName: (pres.customer_name as string | null) ?? null,
    presentationTitle: String(pres.title ?? "Portföy sunumu"),
    propertyLabel: String(property.title || property.property_code || "portföy"),
    note,
  });
  const at = now();
  const hourKey = `${trDayKey(at)}T${String(trParts(at).hour).padStart(2, "0")}`;
  let notified = false;
  try {
    await notifyTenant({
      tenantId,
      userId: creator?.id ?? null,
      title: message.title,
      body: message.body,
      href: presentationFeedbackHref(customerId),
      kind: message.kind,
      prefKey: "share",
      dedupeKey: presentationFeedbackDedupeKey(pres.id as string, propertyId, verdict, hourKey),
    });
    notified = true;
  } catch (e) {
    console.error("submitPresentationFeedback notify", e instanceof Error ? e.message : e);
  }

  if (!stored && !notified) return { ok: false, error: "Geri bildiriminiz iletilemedi. Lütfen tekrar deneyin." };
  return { ok: true, verdict, note };
}
