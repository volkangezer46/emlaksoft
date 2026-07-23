"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformModule, requirePlatformStaff } from "@/lib/platform";
import { setPlatformSetting } from "@/lib/platform-settings";
import { runAdvisor, type AdvisorMessage, type AdvisorResult } from "@/lib/ai-advisor";
import { createAdminClient } from "@/lib/supabase/admin";

const MAX_MESSAGES = 12;
const MAX_LEN = 2000;

// ---------------------------------------------------------------------------
// Sohbet — DB'ye kayıtlı
// ---------------------------------------------------------------------------

export type AskAdvisorResult = AdvisorResult & { sessionId: string };

/**
 * Soruyu yanıtlar ve oturum + mesajları DB'ye kaydeder.
 * `sessionId` verilirse mevcut oturuma ekler; verilmezse yeni oturum açar.
 */
export async function askAdvisor(
  messages: AdvisorMessage[],
  sessionId?: string | null,
): Promise<AskAdvisorResult> {
  const staff = await requirePlatformModule("advisor");

  const clean = (Array.isArray(messages) ? messages : [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-MAX_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_LEN) }));

  if (clean.length === 0 || clean[clean.length - 1]!.role !== "user") {
    return {
      reply: "Bir soru yazın; canlı verilerle yanıtlayayım.",
      usedAI: false,
      sessionId: sessionId ?? "",
    };
  }

  const result = await runAdvisor(clean);

  // DB'ye kaydet (hata olursa sessizce geç — UI kırılmasın)
  try {
    const admin = createAdminClient();
    let sid = sessionId;

    if (!sid) {
      // Yeni oturum — başlık ilk sorudan türetilir (ilk 60 karakter)
      const firstUserMsg = clean.find((m) => m.role === "user")?.content ?? "Yeni sohbet";
      const title = firstUserMsg.slice(0, 60) + (firstUserMsg.length > 60 ? "…" : "");
      const { data: session } = await admin
        .from("advisor_sessions")
        .insert({ staff_id: staff.id, title })
        .select("id")
        .single();
      sid = session?.id ?? null;
    }

    if (sid) {
      // Son kullanıcı mesajını ve asistan yanıtını kaydet
      const lastUser = clean[clean.length - 1]!;
      await admin.from("advisor_messages").insert([
        { session_id: sid, role: "user", content: lastUser.content, used_ai: false },
        { session_id: sid, role: "assistant", content: result.reply, used_ai: result.usedAI },
      ]);
    }

    return { ...result, sessionId: sid ?? "" };
  } catch (e) {
    console.error("askAdvisor:db", e);
    return { ...result, sessionId: sessionId ?? "" };
  }
}

// ---------------------------------------------------------------------------
// Oturum listesi
// ---------------------------------------------------------------------------

export type SessionSummary = {
  id: string;
  title: string | null;
  updated_at: string;
  message_count: number;
};

export async function listAdvisorSessions(limit = 20): Promise<SessionSummary[]> {
  const staff = await requirePlatformModule("advisor");
  const admin = createAdminClient();

  const { data } = await admin
    .from("advisor_sessions")
    .select("id, title, updated_at, advisor_messages(count)")
    .eq("staff_id", staff.id)
    .order("updated_at", { ascending: false })
    .limit(limit);

  return (data ?? []).map((s) => ({
    id: s.id,
    title: s.title,
    updated_at: s.updated_at,
    // Supabase count agregası nested olarak gelir
    message_count: (s.advisor_messages as unknown as { count: number }[])?.[0]?.count ?? 0,
  }));
}

// ---------------------------------------------------------------------------
// Oturum mesajları — geçmişi yükle
// ---------------------------------------------------------------------------

export type PersistedMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  used_ai: boolean;
  created_at: string;
};

export async function loadAdvisorSession(sessionId: string): Promise<PersistedMessage[]> {
  const staff = await requirePlatformModule("advisor");
  const admin = createAdminClient();

  // Önce oturumun bu personele ait olduğunu doğrula
  const { data: session } = await admin
    .from("advisor_sessions")
    .select("id")
    .eq("id", sessionId)
    .eq("staff_id", staff.id)
    .maybeSingle();

  if (!session) return [];

  const { data } = await admin
    .from("advisor_messages")
    .select("id, role, content, used_ai, created_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });

  return (data ?? []) as PersistedMessage[];
}

// ---------------------------------------------------------------------------
// Oturum sil
// ---------------------------------------------------------------------------

export async function deleteAdvisorSession(sessionId: string): Promise<{ ok: boolean }> {
  const staff = await requirePlatformModule("advisor");
  const admin = createAdminClient();

  await admin
    .from("advisor_sessions")
    .delete()
    .eq("id", sessionId)
    .eq("staff_id", staff.id);

  return { ok: true };
}

// ---------------------------------------------------------------------------
// OpenAI anahtar yönetimi
// ---------------------------------------------------------------------------

export type KeyResult = { ok?: boolean; error?: string };

export async function saveOpenAiKey(formData: FormData): Promise<KeyResult> {
  const staff = await requirePlatformStaff();
  if (staff.role !== "super_admin") return { error: "Yalnızca süper admin anahtar tanımlayabilir." };

  const key = String(formData.get("key") ?? "").trim();
  if (!key) return { error: "Anahtar boş olamaz." };
  if (!key.startsWith("sk-") || key.length < 20) {
    return { error: "Geçersiz anahtar formatı (sk- ile başlamalı)." };
  }

  await setPlatformSetting("openai_api_key", key, staff.id);
  revalidatePath("/admin/sistem");
  revalidatePath("/admin/danisman");
  return { ok: true };
}

export async function clearOpenAiKey(): Promise<KeyResult> {
  const staff = await requirePlatformStaff();
  if (staff.role !== "super_admin") return { error: "Yalnızca süper admin anahtar silebilir." };

  await setPlatformSetting("openai_api_key", null, staff.id);
  revalidatePath("/admin/sistem");
  revalidatePath("/admin/danisman");
  return { ok: true };
}
