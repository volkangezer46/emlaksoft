"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { getOpenAiKey } from "@/lib/ai-advisor";
import { externalErrorMetadata } from "@/lib/external-fetch";
import { getOpenAiChatModel, openAiChat, openAiTranscribe } from "@/lib/ai/openai-client";
import { canAutoCallAi } from "@/lib/ai/auto-call-gate";
import { getSetting } from "@/lib/settings/read";
import { AI_VOICE_NOTES_KEY } from "@/lib/settings/registry/tenant";
import { now } from "@/lib/clock";
import { formatDateTimeTr } from "@/lib/format";
import { actionErrorMessage } from "@/lib/action-errors";
import {
  VOICE_NOTE_MAX_BYTES,
  VOICE_NOTE_MAX_TEXT,
  buildVoiceSummaryMessages,
  checkVoiceSummary,
  fileNameForAudio,
  formatVoiceNote,
  isAllowedAudioType,
} from "@/lib/ai/voice-note";

export type VoiceNoteKind = "customer" | "appointment";
export type VoiceDraftResult = { ok?: boolean; error?: string; transcript?: string; summary?: string };
export type VoiceSaveResult = { ok?: boolean; error?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function officeEnabled(tenantId: string): Promise<boolean> {
  try {
    return (await getSetting<boolean>(AI_VOICE_NOTES_KEY, { tenantId })) === true;
  } catch {
    return false;
  }
}

/** Kayıt düğmesi görünsün mü? (ofis ayarı + OpenAI anahtarı + kullanıcı müşteri düzenleme izni) */
export async function getVoiceNoteAvailability(): Promise<{ enabled: boolean }> {
  const gate = await requirePermission("customers", "edit");
  if (!gate.ok) return { enabled: false };
  if (!(await officeEnabled(gate.tenantId))) return { enabled: false };
  return { enabled: Boolean(await getOpenAiKey()) };
}

/**
 * Ses kaydını yazıya çevirip özetler ve TASLAK döner (hiçbir şey kaydedilmez). Ses dosyası saklanmaz: yalnız bu istek
 * boyunca bellekte tutulur. KVKK: kayıt için ilgili kişinin açık rızası alınmış olmalıdır (onay kutusu `consent=on`).
 * Çağrılar yalnız `openai-client` üzerinden gider; transkript özetlenmeden önce kişisel veriden maskelenir.
 */
export async function transcribeVoiceNote(formData: FormData): Promise<VoiceDraftResult> {
  const gate = await requirePermission("customers", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!(await officeEnabled(gate.tenantId))) return { error: "Sesli not özelliği bu ofiste kapalı (Ayarlar > Yapay zekâ özellikleri)." };
  if (formData.get("consent") !== "on") return { error: "Kayıttan önce ilgili kişinin açık rızasını onaylayın." };

  const file = formData.get("audio");
  if (!(file instanceof Blob) || file.size === 0) return { error: "Ses kaydı alınamadı. Mikrofonu kontrol edip tekrar kaydedin." };
  if (file.size > VOICE_NOTE_MAX_BYTES) return { error: "Ses kaydı çok uzun (en fazla yaklaşık 3 dakika)." };
  if (!isAllowedAudioType(file.type)) return { error: "Bu ses biçimi desteklenmiyor." };

  const apiKey = await getOpenAiKey();
  if (!apiKey) return { error: "Yapay zekâ anahtarı tanımlı değil." };
  if (!(await canAutoCallAi(gate.tenantId))) return { error: "AI kotanız doldu; sesli not bu dönem özetlenemiyor." };

  const audit = { tenantId: gate.tenantId, actorId: gate.userId };
  try {
    const transcript = await openAiTranscribe({
      apiKey,
      purpose: "voice_note_transcribe",
      audio: file,
      fileName: fileNameForAudio(file.type),
      timeoutMs: 60_000,
      maxResponseBytes: 256 * 1024,
      audit,
    });
    if (!transcript) return { error: "Konuşma anlaşılamadı; tekrar deneyin." };
    const text = transcript.slice(0, VOICE_NOTE_MAX_TEXT);
    const { system, user } = buildVoiceSummaryMessages(text);
    const { content } = await openAiChat({
      apiKey,
      purpose: "voice_note_summary",
      audit,
      timeoutMs: 30_000,
      maxResponseBytes: 128 * 1024,
      body: {
        model: getOpenAiChatModel(),
        temperature: 0.2,
        max_tokens: 400,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      },
    });
    const checked = checkVoiceSummary(content, text);
    // Özet reddedilirse yalnız transkript sunulur; kullanıcı elle özetler.
    return { ok: true, transcript: text, summary: checked.ok ? checked.text : "" };
  } catch (e) {
    console.error("transcribeVoiceNote", externalErrorMetadata(e));
    return { error: "Sesli not şu an işlenemedi. Biraz sonra tekrar deneyin." };
  }
}

/**
 * Onaylanan (düzenlenebilir) özet + transkripti NOT olarak kaydeder. Müşteri kartında müşteri notlarına, randevuda randevu
 * notuna (ve randevunun müşterisi varsa müşteri notlarına) eklenir. Ses dosyası yoktur.
 */
export async function saveVoiceNote(input: { kind: VoiceNoteKind; id: string; summary: string; transcript: string }): Promise<VoiceSaveResult> {
  const gate = await requirePermission(input?.kind === "appointment" ? "appointments" : "customers", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!(await officeEnabled(gate.tenantId))) return { error: "Sesli not özelliği bu ofiste kapalı." };
  const id = String(input?.id ?? "").trim();
  if (!UUID_RE.test(id)) return { error: "Kayıt bulunamadı." };
  const summary = String(input?.summary ?? "").trim();
  const transcript = String(input?.transcript ?? "").trim();
  if (!summary && !transcript) return { error: "Kaydedilecek metin yok." };

  const body = formatVoiceNote({ summary, transcript, stamp: formatDateTimeTr(now()) });
  const supabase = await createClient();

  let customerId: string | null = null;
  if (input.kind === "appointment") {
    const { data: appt } = await supabase.from("appointments").select("id, customer_id, notes").eq("id", id).eq("tenant_id", gate.tenantId).maybeSingle();
    if (!appt) return { error: "Randevu bulunamadı." };
    customerId = (appt.customer_id as string | null) ?? null;
    const merged = [appt.notes as string | null, body].filter(Boolean).join("\n\n").slice(0, 8000);
    const { error } = await supabase.from("appointments").update({ notes: merged }).eq("id", id).eq("tenant_id", gate.tenantId);
    if (error) return { error: actionErrorMessage(error, "Not kaydedilemedi.") };
    revalidatePath("/app/randevular");
  } else {
    const { data: cust } = await supabase.from("customers").select("id").eq("id", id).eq("tenant_id", gate.tenantId).is("deleted_at", null).maybeSingle();
    if (!cust) return { error: "Müşteri bulunamadı." };
    customerId = id;
  }

  if (customerId) {
    const { error } = await supabase.from("communications").insert({
      tenant_id: gate.tenantId,
      customer_id: customerId,
      created_by: gate.userId,
      channel: "note",
      direction: "outbound",
      subject: "Sesli not (AI özeti)",
      body,
    });
    if (error) return { error: actionErrorMessage(error, "Not kaydedilemedi.") };
    revalidatePath(`/app/musteriler/${customerId}`);
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "voice_note.saved",
    entityType: input.kind === "appointment" ? "appointment" : "customer",
    entityId: id,
    // Metin LOG'a yazılmaz; yalnız uzunluk.
    newValue: { summary_length: summary.length, transcript_length: transcript.length },
  });
  return { ok: true };
}
