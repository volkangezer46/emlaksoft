"use server";

import { updateTag } from "next/cache";
import { headers } from "next/headers";
import { legalConsentUserTag } from "@/lib/legal-docs/consent-cache";
import { pendingReconsents } from "@/lib/legal-docs/core";
import { insertConsents, readReconsentDocs, readUserConsentState } from "@/lib/legal-docs/store";
import { clientIp } from "@/lib/rate-limit";
import { getRequestUser } from "@/lib/supabase/auth-cache";

/**
 * Yeniden onay (AD12): kullanıcı güncellenen yasal metinleri onaylar. Bekleyen liste SUNUCUDA yeniden hesaplanır
 * (istemciden gelen sürüme güvenilmez); her belge için yayındaki sürüm, sunucu zamanı, istek IP'si ve tarayıcı bilgisi
 * `legal_consents`'e yazılır. Aynı sürüm ikinci kez yazılmaz.
 */
export async function acceptLegalUpdates(): Promise<{ ok: boolean; error?: string }> {
  const user = await getRequestUser();
  if (!user) return { ok: false, error: "Oturum bulunamadı; yeniden giriş yapın." };
  const docs = await readReconsentDocs();
  if (!docs.length) return { ok: true };
  let state: Awaited<ReturnType<typeof readUserConsentState>>;
  try {
    state = await readUserConsentState(user.id, docs.map((d) => d.slug));
  } catch {
    return { ok: false, error: "Onay durumu okunamadı; tekrar deneyin." };
  }
  const pending = pendingReconsents(docs, state.consents, state.userCreatedAt);
  if (!pending.length) return { ok: true };
  const [ip, h] = await Promise.all([clientIp().catch(() => ""), headers()]);
  const ua = (h.get("user-agent") ?? "").slice(0, 512) || null;
  const ok = await insertConsents(
    pending.map((p) => ({ userId: user.id, tenantId: state.tenantId, document: p.slug, version: p.version, ip: ip ? ip.slice(0, 128) : null, userAgent: ua })),
  );
  if (!ok) return { ok: false, error: "Onay kaydedilemedi; tekrar deneyin." };
  // Kullanıcıya özel bekleyen-onay önbelleği (kabuk kapısı) tazelenir: pencere bir sonraki gezinmede çıkmaz.
  updateTag(legalConsentUserTag(user.id));
  return { ok: true };
}
