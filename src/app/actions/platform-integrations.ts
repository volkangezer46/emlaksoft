"use server";

import { revalidatePath } from "next/cache";
import { isHubKey, testAction } from "@/lib/admin/integration-hub/model";
import { runIntegrationProbe } from "@/lib/admin/integration-hub/probe";
import { logPlatformActivity } from "@/lib/platform-activity";
import { guardPlatformAction } from "@/lib/platform-guards";

/**
 * Entegrasyon merkezi "Test et" (Admin > Sistem > Entegrasyonlar). Kapı: `sistem` modülü + personel başına hız sınırı
 * (dış servise istek atar). Yoklama zararsızdır (bkz. probe.ts); sonuç `integration.<anahtar>.test` eylemiyle
 * platform_audit_logs'a yazılır ve kart "son test" satırını buradan okur. Anahtar değeri sonuca ve denetime girmez.
 */

export type IntegrationTestResult = { ok?: boolean; error?: string; message?: string; durationMs?: number };

export async function testIntegration(key: string): Promise<IntegrationTestResult> {
  const g = await guardPlatformAction({ module: "sistem", rate: { key: "platform-integration-test", limit: 30, windowSec: 600 } });
  if ("error" in g) return { error: g.error };
  if (!isHubKey(key)) return { error: "Bilinmeyen entegrasyon; sayfayı yenileyip tekrar deneyin." };

  const out = await runIntegrationProbe(key);
  await logPlatformActivity({
    actorId: g.staff.id,
    action: testAction(key),
    entityType: "integration",
    meta: { ok: out.ok, code: out.code, message: out.message, duration_ms: out.durationMs },
  });
  revalidatePath("/admin/sistem");
  return { ok: out.ok, message: out.message, durationMs: out.durationMs };
}
