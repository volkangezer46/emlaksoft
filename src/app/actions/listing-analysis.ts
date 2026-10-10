"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/require-permission";
import { checkRateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { runListingAnalysis, type ListingAnalysisOutcome } from "@/lib/ef-credits/listing-analysis";

/**
 * İlan analizi (KONTÖRSÜZ). Yetki: valuation.create; hız sınırı; 24 saat önbellek
 * `src/lib/ef-credits/listing-analysis.ts`tedir. Kullanıcıya EmlakFiyati anahtarı/URL'si ASLA dönmez.
 */

export type ListingAnalysisActionResult = { ok: true; outcome: ListingAnalysisOutcome } | { ok: false; error: string };

const idSchema = z.string().uuid();

export async function analyzeListing(propertyId: string): Promise<ListingAnalysisActionResult> {
  const gate = await requirePermission("valuation", "create");
  if (!gate.ok) return { ok: false, error: gate.error };
  const id = idSchema.safeParse(propertyId);
  if (!id.success) return { ok: false, error: "Geçersiz portföy." };
  const limit = await checkRateLimit(`listing-analysis:${gate.userId}`, { limit: 20, windowSec: 600, failurePolicy: "deny" });
  if (!limit.allowed) return { ok: false, error: "Çok fazla istek. Lütfen birkaç dakika sonra tekrar deneyin." };

  const supabase = await createClient();
  const outcome = await runListingAnalysis({ supabase, tenantId: gate.tenantId, userId: gate.userId, propertyId: id.data });
  if (outcome.status === "ok" && !outcome.cached) revalidatePath(`/app/portfoyler/${id.data}`);
  return { ok: true, outcome };
}
