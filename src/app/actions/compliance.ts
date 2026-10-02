"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
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

  const admin = createAdminClient();
  const { error } = await admin.rpc("transition_iys_consent", {
    p_tenant_id: gate.tenantId,
    p_customer_id: customerId,
    p_channel: channel,
    p_status: status,
    p_source: "manual",
    p_actor_id: gate.userId,
    p_evidence: { entrypoint: "compliance_form" },
  });

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
