"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { checkAuthorityShield as runShield } from "@/lib/authority-shield";

export type ComplianceResult = { error?: string; ok?: boolean };

const CHANNELS = ["sms", "email", "whatsapp", "call"] as const;

export async function upsertIysConsent(formData: FormData): Promise<ComplianceResult> {
  const gate = await requirePermission("compliance", "edit");
  if (!gate.ok) return { error: gate.error };

  const customerId = String(formData.get("customer_id") ?? "").trim();
  const channel = String(formData.get("channel") ?? "").trim() as (typeof CHANNELS)[number];
  const status = String(formData.get("status") ?? "granted").trim();

  if (!customerId) return { error: "Müşteri zorunlu." };
  if (!CHANNELS.includes(channel)) return { error: "Geçersiz kanal." };
  if (!["granted", "denied", "unknown", "pending"].includes(status)) {
    return { error: "Geçersiz durum." };
  }

  const supabase = await createClient();
  const now = new Date().toISOString();
  const { error } = await supabase.from("iys_consents").upsert(
    {
      tenant_id: gate.tenantId,
      customer_id: customerId,
      channel,
      status,
      source: "manual",
      granted_at: status === "granted" ? now : null,
      revoked_at: status === "denied" ? now : null,
    },
    { onConflict: "tenant_id,customer_id,channel" },
  );

  if (error) {
    console.error("upsertIysConsent", error);
    return { error: "İYS kaydı güncellenemedi." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "iys.upsert",
    entityType: "customer",
    entityId: customerId,
    newValue: { channel, status },
  });

  revalidatePath("/app/uyum");
  revalidatePath(`/app/musteriler/${customerId}`);
  return { ok: true };
}

export async function checkAuthorityShield(input: {
  hasWrittenAuthority: boolean;
  transactionType?: string;
}): Promise<{ ok: boolean; warning?: string }> {
  return runShield({ hasWrittenAuthority: input.hasWrittenAuthority });
}
