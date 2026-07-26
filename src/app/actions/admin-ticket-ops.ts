"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";

/**
 * Admin tarafı ticket operasyonları: personel atama + hazır yanıt makroları.
 * Tenant/staff yanıt akışı `tickets.ts` içinde — burası yalnızca /admin.
 */

export type AdminTicketOpsResult = { error?: string; ok?: boolean };

function revalidateTicketPages(id?: string) {
  revalidatePath("/admin/tickets");
  if (id) revalidatePath(`/admin/tickets/${id}`);
}

/** Ticket'ı bir platform personeline atar; boş değer atamayı kaldırır. */
export async function assignTicketStaff(formData: FormData): Promise<AdminTicketOpsResult> {
  await requirePlatformModule("tickets");

  const id = String(formData.get("id") ?? "").trim();
  const staffId = String(formData.get("staff_id") ?? "").trim();
  if (!id) return { error: "Ticket bulunamadı." };

  const admin = createAdminClient();

  if (staffId) {
    const { data: staffRow } = await admin
      .from("platform_staff")
      .select("id")
      .eq("id", staffId)
      .eq("is_active", true)
      .maybeSingle();
    if (!staffRow) return { error: "Geçersiz personel." };
  }

  const { error } = await admin
    .from("support_tickets")
    .update({ assigned_staff_id: staffId || null, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: "Atama kaydedilemedi." };

  revalidateTicketPages(id);
  return { ok: true };
}

/** <form action> için void sarmalayıcı. */
export async function assignTicketStaffAction(formData: FormData): Promise<void> {
  await assignTicketStaff(formData);
}

/** Hazır yanıt makrosu ekler — yalnızca süper admin. */
export async function createTicketMacro(formData: FormData): Promise<AdminTicketOpsResult> {
  const staff = await requirePlatformModule("tickets");
  if (staff.role !== "super_admin") return { error: "Yalnızca süper admin makro ekleyebilir." };

  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  if (!title || !body) return { error: "Başlık ve içerik zorunlu." };
  if (title.length > 120) return { error: "Başlık en fazla 120 karakter olabilir." };

  const admin = createAdminClient();
  const { error } = await admin
    .from("ticket_macros")
    .insert({ title, body, created_by: staff.id });
  if (error) return { error: "Makro eklenemedi." };

  revalidateTicketPages();
  return { ok: true };
}

export async function createTicketMacroAction(formData: FormData): Promise<void> {
  await createTicketMacro(formData);
}

/** Hazır yanıt makrosu siler — yalnızca süper admin. */
export async function deleteTicketMacro(formData: FormData): Promise<AdminTicketOpsResult> {
  const staff = await requirePlatformModule("tickets");
  if (staff.role !== "super_admin") return { error: "Yalnızca süper admin makro silebilir." };

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "Makro bulunamadı." };

  const admin = createAdminClient();
  const { error } = await admin.from("ticket_macros").delete().eq("id", id);
  if (error) return { error: "Makro silinemedi." };

  revalidateTicketPages();
  return { ok: true };
}

export async function deleteTicketMacroAction(formData: FormData): Promise<void> {
  await deleteTicketMacro(formData);
}
