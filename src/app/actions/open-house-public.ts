"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { isPast } from "@/lib/clock";
import { notifyTenant } from "@/lib/notify";
import { isValidTurkishMobile, normalizeTurkishPhone, TR_MOBILE_ERROR_MESSAGE } from "@/lib/phone";

export type PublicCheckinResult = {
  ok?: boolean;
  error?: string;
  /** Aynı telefon bu etkinliğe zaten kayıtlıysa true — teşekkür ekranı yine gösterilir. */
  alreadyRegistered?: boolean;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Etkinlik bitişi: scheduled_at + duration_min. Bittiyse kayıt kapalı. */
function eventEndIso(scheduledAt: string, durationMin: number | null): string {
  const end = new Date(scheduledAt).getTime() + (durationMin ?? 120) * 60_000;
  return new Date(end).toISOString();
}

/**
 * Açık ev self check-in (/acik-ev-kayit/[token] public sayfası).
 *
 * Auth YOK — public_token yeterli (respondToAppointmentByToken deseni).
 * RLS anon'a açılmadığı için service role ile yazılır. Ziyaretçi kapıdaki
 * QR'ı okutup kendi adını/telefonunu girer; kayıt kapıda-kayıt action'ının
 * (`registerOpenHouseVisitor`) yazdığı aynı `open_house_visitors` şemasına
 * düşer ve danışman detay sayfasındaki listede anında görür.
 */
export async function registerOpenHouseVisitorByToken(fd: FormData): Promise<PublicCheckinResult> {
  const token = String(fd.get("token") ?? "").trim();
  const fullName = String(fd.get("full_name") ?? "").trim();
  const phoneRaw = String(fd.get("phone") ?? "").trim();
  const kvkk = String(fd.get("kvkk") ?? "") === "on";
  // Honeypot — botlar gizli alanı doldurur; sessizce "başarılı" davran (lead formu deseni).
  if (String(fd.get("website") ?? "").trim()) return { ok: true };

  if (!UUID_RE.test(token)) return { error: "Geçersiz bağlantı." };
  if (!fullName) return { error: "Ad soyad zorunludur." };
  if (!isValidTurkishMobile(phoneRaw)) return { error: TR_MOBILE_ERROR_MESSAGE };
  if (!kvkk) return { error: "Devam etmek için KVKK onayı gereklidir." };

  // Token tahmini / spam koruması — IP başına dakikada 10 kayıt denemesi.
  const ip = await clientIp();
  const { allowed } = await checkRateLimit(`acik-ev-kayit:${ip}`, { limit: 10, windowSec: 60 });
  if (!allowed) return { error: "Çok fazla istek. Lütfen biraz sonra tekrar deneyin." };

  const admin = createAdminClient();
  const { data: event } = await admin
    .from("open_houses")
    .select("id, tenant_id, created_by, scheduled_at, duration_min, status, property:properties(title, property_code)")
    .eq("public_token", token)
    .maybeSingle();

  if (!event) return { error: "Bağlantı geçersiz veya etkinlik bulunamadı." };
  if (event.status === "cancelled") return { error: "Bu açık ev etkinliği iptal edilmiş." };
  if (event.status === "completed" || isPast(eventEndIso(event.scheduled_at, event.duration_min))) {
    return { error: "Bu açık ev etkinliği sona erdi." };
  }

  const phone = normalizeTurkishPhone(phoneRaw);

  // Mükerrer kayıt engeli (etkinlik + telefon): aynı ziyaretçi QR'ı ikinci kez
  // okutursa yeni satır ve yeni bildirim üretme — teşekkür ekranını yine göster.
  const { data: existing } = await admin
    .from("open_house_visitors")
    .select("id")
    .eq("open_house_id", event.id)
    .eq("phone", phone)
    .limit(1)
    .maybeSingle();
  if (existing) return { ok: true, alreadyRegistered: true };

  const { error } = await admin.from("open_house_visitors").insert({
    open_house_id: event.id,
    full_name: fullName,
    phone,
    notes: "QR ile kendisi kaydoldu",
  });
  if (error) {
    console.error("registerOpenHouseVisitorByToken", error);
    return { error: "Kayıt oluşturulamadı. Lütfen tekrar deneyin." };
  }

  await admin.rpc("increment_visitor_count", { open_house_id: event.id }).maybeSingle();

  // Danışmana (etkinliği oluşturana) bildirim — hata teşekkür ekranını düşürmesin.
  const prop = event.property as { title?: string | null; property_code?: string | null } | { title?: string | null; property_code?: string | null }[] | null;
  const propOne = Array.isArray(prop) ? prop[0] : prop;
  const propLabel = propOne?.title ?? propOne?.property_code ?? "Açık ev";
  try {
    await notifyTenant({
      tenantId: String(event.tenant_id),
      userId: (event.created_by as string | null) ?? null,
      title: `Açık ev kaydı: ${fullName}`,
      body: `${propLabel} etkinliğine QR ile yeni ziyaretçi kaydoldu.`,
      href: `/app/acik-ev/${event.id}`,
      kind: "success",
      prefKey: "appointment",
    });
  } catch (e) {
    console.error("open house checkin notify", e);
  }

  revalidatePath(`/app/acik-ev/${event.id}`);
  revalidatePath("/app/acik-ev");
  return { ok: true };
}
