"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { isMissingTableError, isUuid, validateNoteInput } from "@/lib/neighborhood-notes/notes";

/**
 * Mahalle notu (F5) yazma eylemleri. Notlar ofis içidir: kiracı kimliği oturumdan gelir, RLS ikinci kapıdır.
 * Yetki: `properties` modülü (yeni modül kaydı gerekmez). Silme yumuşaktır (deleted_at).
 */

export type NoteActionResult = { ok: true } | { ok: false; error: string };

export async function createNeighborhoodNote(input: {
  neighborhoodId: string;
  tags: string[];
  body: string;
}): Promise<NoteActionResult> {
  const gate = await requirePermission("properties", "create");
  if (!gate.ok) return { ok: false, error: gate.error };

  const parsed = validateNoteInput(input);
  if (!parsed.ok) return parsed;

  const supabase = await createClient();
  // Mahalle gerçekten var mı (geo_* herkese açık okunur)?
  const { data: hood } = await supabase
    .from("geo_neighborhoods")
    .select("id")
    .eq("id", parsed.value.neighborhoodId)
    .maybeSingle();
  if (!hood) return { ok: false, error: "Seçilen mahalle bulunamadı." };

  const { error } = await supabase.from("neighborhood_notes").insert({
    tenant_id: gate.tenantId,
    neighborhood_id: parsed.value.neighborhoodId,
    tags: parsed.value.tags,
    body: parsed.value.body,
    created_by: gate.userId,
  });
  if (error) {
    return {
      ok: false,
      error: isMissingTableError(error) ? "Mahalle notları bu ortamda henüz etkin değil." : "Not kaydedilemedi. Lütfen tekrar deneyin.",
    };
  }
  revalidatePath("/app/mahalle-notlari");
  return { ok: true };
}

export async function deleteNeighborhoodNote(id: string): Promise<NoteActionResult> {
  const gate = await requirePermission("properties", "edit");
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!isUuid(id)) return { ok: false, error: "Geçersiz not." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("neighborhood_notes")
    .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .is("deleted_at", null);
  if (error) return { ok: false, error: "Not silinemedi. Lütfen tekrar deneyin." };
  revalidatePath("/app/mahalle-notlari");
  return { ok: true };
}
