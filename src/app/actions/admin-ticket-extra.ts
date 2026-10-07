"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformModule } from "@/lib/platform";
import { logPlatformActivity } from "@/lib/platform-activity";
import { checkRateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { TICKET_LIMITS, isUuid } from "@/lib/support/ticket-contract";
import type { ComboboxOption } from "@/components/ui/combobox";
import { actionErrorMessage } from "@/lib/action-errors";

export type MacroEditResult = { ok?: boolean; error?: string };

/** Yeni talep sayfasındaki ofis seçimi için sunucu araması (tickets modülü yetkisi şart). */
export async function searchTicketTenants(query: string): Promise<ComboboxOption[]> {
  await requirePlatformModule("tickets");
  const q = query.trim();
  if (q.length < 2) return [];
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("tenants")
    .select("id, name, slug, status")
    .ilike("name", `%${q.replace(/[%_]/g, "")}%`)
    .order("name")
    .limit(25);
  if (error || !data) return [];
  return data.map((t) => ({ value: t.id, label: t.name, hint: `/${t.slug} · ${t.status}` }));
}

/** Hazır yanıtı düzenler (başlık + metin) — yalnızca süper admin. */
export async function updateTicketMacro(formData: FormData): Promise<MacroEditResult> {
  const staff = await requirePlatformModule("tickets");
  if (staff.role !== "super_admin") return { error: "Yalnızca süper admin makro düzenleyebilir." };
  const rl = await checkRateLimit(`ticket-macro-edit:${staff.id}`, { limit: 40, windowSec: 600, failurePolicy: "deny" });
  if (!rl.allowed) return { error: "Çok sık işlem yapıldı. Lütfen kısa bir süre sonra yeniden deneyin." };
  const id = String(formData.get("id") ?? "").trim();
  if (!isUuid(id)) return { error: "Makro bulunamadı." };
  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  if (!title || !body) return { error: "Başlık ve içerik zorunlu." };
  if (title.length > TICKET_LIMITS.macroTitleMax || body.length > TICKET_LIMITS.macroBodyMax) {
    return { error: "Hazır yanıt izin verilen uzunluğu aşıyor." };
  }
  const admin = createAdminClient();
  const { data, error } = await admin.from("ticket_macros").update({ title, body }).eq("id", id).select("id").maybeSingle();
  if (error) {
    console.error("updateTicketMacro", error.message);
    return { error: actionErrorMessage(error, "Makro güncellenemedi.") };
  }
  if (!data) return { error: "Makro bulunamadı." };
  await logPlatformActivity({ actorId: staff.id, action: "ticket.macro.update", entityType: "ticket_macro", entityId: id });
  revalidatePath("/admin/tickets");
  revalidatePath("/admin/tickets/makrolar");
  return { ok: true };
}
