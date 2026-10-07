"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { checkRateLimit } from "@/lib/rate-limit";
import { daysFromNowIso } from "@/lib/clock";
import { getOpenAiChatModel, openAiChat } from "@/lib/ai/openai-client";
import { canAutoCallAi } from "@/lib/ai/auto-call-gate";
import { ASSISTANT_ACTION_SYSTEM_PROMPT, AssistantProposalSchema, parseAssistantProposal, type AssistantProposal } from "@/lib/ai/assistant-actions";
import { actionErrorMessage } from "@/lib/action-errors";

export type ProposeResult = { ok?: boolean; error?: string; proposal?: AssistantProposal };
export type ApproveResult = { ok?: boolean; error?: string; createdTasks?: number; draft?: string };

/**
 * İstekten eylem ÖNERİSİ üretir (hiçbir kayda yazmaz). Kota kapısı: ofisin AI kotası dolduysa çağrı yapılmaz.
 * OpenAI yalnız `openai-client` üzerinden (kişisel veri maskeli, audit + kredi ölçümü zorunlu).
 */
export async function proposeAssistantAction(prompt: string): Promise<ProposeResult> {
  const gate = await requirePermission("tasks", "create");
  if (!gate.ok) return { error: gate.error };
  const text = String(prompt ?? "").trim();
  if (text.length < 5 || text.length > 1000) return { error: "İsteği 5-1000 karakter arasında yazın." };
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { error: "AI asistan için OpenAI anahtarı tanımlı değil." };
  if (!(await canAutoCallAi(gate.tenantId))) return { error: "Ofisin bu ayki AI kotası doldu; eylem önerisi üretilemiyor." };
  const rl = await checkRateLimit(`assistant-action:${gate.userId}`, { limit: 20, windowSec: 600, failurePolicy: "deny" });
  if (!rl.allowed) return { error: "Çok fazla istek; birkaç dakika sonra tekrar deneyin." };
  try {
    const { content } = await openAiChat({
      apiKey: key,
      purpose: "assistant_action",
      audit: { tenantId: gate.tenantId, actorId: gate.userId },
      timeoutMs: 30_000,
      maxResponseBytes: 64 * 1024,
      body: {
        model: getOpenAiChatModel(),
        temperature: 0.2,
        max_tokens: 500,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: ASSISTANT_ACTION_SYSTEM_PROMPT },
          { role: "user", content: text },
        ],
      },
    });
    const parsed = parseAssistantProposal(content);
    if (!parsed.ok) return { error: parsed.error };
    return { ok: true, proposal: parsed.proposal };
  } catch {
    return { error: "Asistan şu an yanıt veremedi; tekrar deneyin." };
  }
}

/**
 * Kullanıcının ONAYLADIĞI öneriyi uygular. Öneri istemciden geri geldiği için yeniden doğrulanır (güvenilmez girdi).
 * Görevler kullanıcının kendisine atanır; mesaj taslağı yazılmaz/gönderilmez (yalnız denetim kaydı + metin döner).
 */
export async function approveAssistantAction(input: unknown): Promise<ApproveResult> {
  const gate = await requirePermission("tasks", "create");
  if (!gate.ok) return { error: gate.error };
  const parsed = AssistantProposalSchema.safeParse(input);
  if (!parsed.success) return { error: "Öneri geçersiz." };
  const p = parsed.data;
  if (p.type === "message_draft") {
    await logActivity({ tenantId: gate.tenantId, actorId: gate.userId, action: "assistant.action_approved", entityType: "assistant", newValue: { type: p.type, channel: p.channel } });
    return { ok: true, draft: p.message };
  }
  const rows =
    p.type === "task"
      ? [{ title: p.title, notes: p.note ?? null, due: p.dueInDays }]
      : p.steps.map((s) => ({ title: `${p.title}: ${s.title}`.slice(0, 200), notes: null, due: s.dayOffset }));
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
    .insert(
      rows.map((r) => ({
        tenant_id: gate.tenantId,
        title: r.title,
        notes: r.notes ? `${r.notes}\n[asistan]` : "[asistan]",
        kind: "followup",
        priority: "normal",
        status: "open",
        due_at: daysFromNowIso(r.due),
        assigned_to: gate.userId,
        created_by: gate.userId,
      })),
    )
    .select("id");
  if (error) return { error: actionErrorMessage(error, "Görevler oluşturulamadı.") };
  await logActivity({ tenantId: gate.tenantId, actorId: gate.userId, action: "assistant.action_approved", entityType: "assistant", newValue: { type: p.type, tasks: data?.length ?? 0 } });
  revalidatePath("/app/gorevler");
  return { ok: true, createdTasks: data?.length ?? 0 };
}
