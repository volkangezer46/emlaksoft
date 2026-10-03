"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { isPast } from "@/lib/clock";
import { notifyTenant } from "@/lib/notify";
import { parsePhone, PHONE_ERROR_MESSAGE } from "@/lib/phone";
import { isPublicTenantActive } from "@/lib/public-tenant";

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
  if (!fullName || fullName.length > 160) return { error: "Geçerli bir ad soyad girin." };
  const phoneParsed = parsePhone(phoneRaw);
  if (!phoneParsed.ok) return { error: phoneParsed.error ?? PHONE_ERROR_MESSAGE };
  if (!kvkk) return { error: "Devam etmek için KVKK onayı gereklidir." };

  // Token tahmini / spam koruması — IP başına dakikada 10 kayıt denemesi.
  const ip = await clientIp();
  const { allowed } = await checkRateLimit(`acik-ev-kayit:${ip}`, {
    limit: 10,
    windowSec: 60,
    failurePolicy: "deny",
  });
  if (!allowed) return { error: "Çok fazla istek. Lütfen biraz sonra tekrar deneyin." };

  const admin = createAdminClient();
  const { data: event } = await admin
    .from("open_houses")
    .select("id, tenant_id, property_id, created_by, scheduled_at, duration_min, status")
    .eq("public_token", token)
    .maybeSingle();

  if (!event) return { error: "Bağlantı geçersiz veya etkinlik bulunamadı." };
  const [{ data: tenant }, { data: property }, { data: creator }] = await Promise.all([
    admin.from("tenants").select("status").eq("id", event.tenant_id).maybeSingle(),
    admin
      .from("properties")
      .select("title, property_code")
      .eq("id", event.property_id)
      .eq("tenant_id", event.tenant_id)
      .is("deleted_at", null)
      .maybeSingle(),
    event.created_by
      ? admin
          .from("profiles")
          .select("id")
          .eq("id", event.created_by)
          .eq("tenant_id", event.tenant_id)
          .eq("is_active", true)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (
    !tenant ||
    !isPublicTenantActive(tenant.status) ||
    !property ||
    (event.created_by && !creator)
  ) {
    return { error: "Bağlantı geçersiz veya etkinlik bulunamadı." };
  }
  if (event.status === "cancelled") return { error: "Bu açık ev etkinliği iptal edilmiş." };
  if (event.status === "completed" || isPast(eventEndIso(event.scheduled_at, event.duration_min))) {
    return { error: "Bu açık ev etkinliği sona erdi." };
  }

  const phone = phoneParsed.stored;

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

  // Danışmana (etkinliği oluşturana) bildirim — hata teşekkür ekranını düşürmesin.
  const propLabel = property.title ?? property.property_code ?? "Açık ev";
  try {
    await notifyTenant({
      tenantId: String(event.tenant_id),
      userId: creator?.id ?? null,
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
