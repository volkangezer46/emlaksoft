"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";

export type PresentationResult = { error?: string; ok?: boolean; id?: string; url?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// "use server" dosyası yalnız async fonksiyon export edebilir → sabit içeride kalır
// (UI tarafındaki eşi: sunumlar/new-presentation-dialog.tsx MAX_SELECT).
const MAX_PRESENTATION_PROPERTIES = 5;

function appUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

/**
 * Müşteriye özel portföy sunumu oluşturur (/sunum/[token] public linki).
 *
 * Yetki bilinçli olarak "view": sunum, danışmanın zaten görebildiği
 * portföyleri müşteriye paketlemesidir — veri değiştirmez. Seçilen id'ler
 * tenant'a ait, silinmemiş VE yayında olmalı: taslak/kapalı portföy müşteri
 * linkine sızmasın (public medya API'si de aynı çizgiyi çeker).
 */
export async function createPresentation(formData: FormData): Promise<PresentationResult> {
  const gate = await requirePermission("properties", "view");
  if (!gate.ok) return { error: gate.error };

  const title = String(formData.get("title") ?? "").trim();
  let customerName = String(formData.get("customer_name") ?? "").trim();
  // Müşteri seçimi OPSİYONEL: boş bırakılırsa eski serbest-metin davranışı aynen sürer.
  const customerIdRaw = String(formData.get("customer_id") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();
  const rawIds = formData
    .getAll("property_ids")
    .map((v) => String(v).trim())
    .filter(Boolean);

  if (!title) return { error: "Sunum başlığı zorunlu." };
  // Aynı id iki kez işaretlenirse tekille — slayt tekrarı anlamsız.
  const ids = [...new Set(rawIds)];
  if (ids.length === 0) return { error: "En az bir portföy seçin." };
  if (ids.length > MAX_PRESENTATION_PROPERTIES)
    return { error: `En fazla ${MAX_PRESENTATION_PROPERTIES} portföy seçilebilir.` };
  if (ids.some((id) => !UUID_RE.test(id))) return { error: "Geçersiz portföy seçimi." };
  if (customerIdRaw && !UUID_RE.test(customerIdRaw)) return { error: "Geçersiz müşteri seçimi." };

  const supabase = await createClient();

  /*
   * Müşteri bağı: id geldiyse tenant'a ait ve silinmemiş olmalı (RLS zaten
   * kiracıyı daraltıyor, burada "silinmiş/yok" durumunu yakalıyoruz). Serbest
   * metin boşsa müşterinin adıyla doldurulur — sunum kapağı isimsiz kalmasın.
   */
  let customerId: string | null = null;
  if (customerIdRaw) {
    const { data: cust } = await supabase
      .from("customers")
      .select("id, full_name")
      .eq("id", customerIdRaw)
      .eq("tenant_id", gate.tenantId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!cust) return { error: "Seçilen müşteri bulunamadı." };
    customerId = cust.id as string;
    if (!customerName) customerName = (cust.full_name as string | null) ?? "";
  }

  const { data: owned } = await supabase
    .from("properties")
    .select("id, status")
    .in("id", ids)
    .eq("tenant_id", gate.tenantId)
    .is("deleted_at", null);
  const ownedLive = new Set(
    (owned ?? []).filter((p) => p.status === "live" || p.status === "Yayında").map((p) => p.id),
  );
  if (ids.some((id) => !ownedLive.has(id)))
    return { error: "Yalnızca yayındaki portföyler sunuma eklenebilir." };

  const { data, error } = await supabase
    .from("presentations")
    .insert({
      tenant_id: gate.tenantId,
      title,
      customer_name: customerName || null,
      customer_id: customerId,
      property_ids: ids,
      note: note || null,
      created_by: gate.userId,
    })
    .select("id, public_token")
    .single();

  if (error || !data) {
    console.error("createPresentation", error);
    return { error: "Sunum oluşturulamadı." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "presentation.create",
    entityType: "presentation",
    entityId: data.id,
    newValue: { title, property_count: ids.length, customer_id: customerId },
  });

  revalidatePath("/app/portfoyler/sunumlar");
  // Müşteri 360'taki "Memnuniyet & Paylaşımlar" bölümü sunumu hemen görsün.
  if (customerId) revalidatePath(`/app/musteriler/${customerId}`);
  return { ok: true, id: data.id, url: `${appUrl()}/sunum/${data.public_token}` };
}

/** Sunumu siler — public link anında ölür. Silme yıkıcı olduğu için "edit" ister. */
export async function deletePresentation(formData: FormData): Promise<PresentationResult> {
  const gate = await requirePermission("properties", "edit");
  if (!gate.ok) return { error: gate.error };

  const id = String(formData.get("id") ?? "").trim();
  if (!UUID_RE.test(id)) return { error: "Geçersiz sunum." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("presentations")
    .delete()
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);
  if (error) {
    console.error("deletePresentation", error);
    return { error: "Sunum silinemedi." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "presentation.delete",
    entityType: "presentation",
    entityId: id,
  });

  revalidatePath("/app/portfoyler/sunumlar");
  return { ok: true };
}
