"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { guardPlatformAction } from "@/lib/platform-guards";
import { logPlatformActivity } from "@/lib/platform-activity";
import { invalidateKnowledgeCache } from "@/lib/ai/zeka/knowledge/store";
import type { ActionOutcome } from "@/lib/action-outcome";

/**
 * Zeka eğitimi eylemleri (platform personeli, `sistem:write`). Onaylı soru-cevap çifti yerel ve GPT motorunun bilgi
 * tabanına girer (süreç içi önbellek boşaltılır; gömme dizini gece bakımında yalnız değişen parçaları yeniden kurar).
 * Yazma oturumlu istemciyle (RLS: platform_staff_can('sistem','write')); service_role yok.
 */

const SURFACES = new Set(["all", "app", "public", "vitrin", "admin"]);
const HREF_RE = /^\/(?![\/\\])[^\s\\]{0,299}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function addZekaQa(formData: FormData): Promise<ActionOutcome> {
  const gate = await guardPlatformAction({ module: "sistem", action: "write", rate: { key: "zeka-qa", limit: 60, windowSec: 600 } });
  if ("error" in gate) return { error: gate.error };
  const question = String(formData.get("question") ?? "").trim().slice(0, 300);
  const answer = String(formData.get("answer") ?? "").trim().slice(0, 2000);
  const surface = String(formData.get("surface") ?? "all");
  const href = String(formData.get("href") ?? "").trim();
  const sourceLogId = String(formData.get("source_log_id") ?? "").trim();
  if (question.length < 3 || answer.length < 3) return { error: "Soru ve yanıt en az 3 karakter olmalı." };
  if (!SURFACES.has(surface)) return { error: "Geçersiz yüzey." };
  if (href && !HREF_RE.test(href)) return { error: "Bağlantı site içi bir yol olmalı (/ ile başlar)." };
  const supabase = await createClient();
  const { error } = await supabase.from("zeka_qa").insert({
    question,
    answer,
    surface,
    href: href || null,
    source_log_id: UUID_RE.test(sourceLogId) ? sourceLogId : null,
    created_by: gate.staff.id,
  });
  if (error) return { error: "Kaydedilemedi (Zeka öğrenme tabloları kurulu mu?)." };
  await logPlatformActivity({ actorId: gate.staff.id, action: "zeka.qa_add", entityType: "zeka_qa", meta: { surface } });
  invalidateKnowledgeCache();
  revalidatePath("/admin/zeka");
  return { ok: true };
}

export async function archiveZekaQa(formData: FormData): Promise<ActionOutcome> {
  const gate = await guardPlatformAction({ module: "sistem", action: "write" });
  if ("error" in gate) return { error: gate.error };
  const id = String(formData.get("id") ?? "");
  if (!UUID_RE.test(id)) return { error: "Geçersiz kayıt." };
  const supabase = await createClient();
  const { error } = await supabase.from("zeka_qa").update({ status: "archived", updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return { error: "Arşivlenemedi." };
  await logPlatformActivity({ actorId: gate.staff.id, action: "zeka.qa_archive", entityType: "zeka_qa", entityId: id });
  invalidateKnowledgeCache();
  revalidatePath("/admin/zeka");
  return { ok: true };
}
