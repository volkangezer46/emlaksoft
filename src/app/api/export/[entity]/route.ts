import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { checkRateLimit } from "@/lib/rate-limit";
import { logActivity } from "@/lib/activity";
import { EXPORT_ENTITIES, isFullExportEntity } from "@/lib/export-entities";
import { EXPORT_QUERIES, openFullCsvStream } from "@/lib/export-full";
import { daysAgoIso } from "@/lib/clock";
import { getEffectivePermissions } from "@/lib/permissions-effective";
import { canSeeAllEarnings } from "@/lib/team/earnings-scope";

// Tam dışa aktarma akışı: sayfa sayfa okur, en fazla ~50 sn sürer.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

function jsonError(error: string, status: number, headers?: Record<string, string>) {
  return NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

/**
 * GET /api/export/[entity] — hızlı dışa aktarmanın 2000 satır sınırı olmayan,
 * akışlı sürümü. Kimlik: oturum çerezi (proxy matcher'ı /api'yi kapsamaz; kapı
 * burada requirePermission ile kurulur). Yetki, tenant ve aktör kapsamı
 * `export.ts` ile aynıdır; veri RLS'li oturum client'ıyla okunur.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ entity: string }> }) {
  const { entity } = await params;
  if (!isFullExportEntity(entity)) return jsonError("Bilinmeyen dışa aktarma türü.", 404);
  const def = EXPORT_ENTITIES[entity]!;

  const gate = await requirePermission(def.module, "view");
  if (!gate.ok) {
    return jsonError(gate.error, gate.error === "Oturum bulunamadı." ? 401 : 403);
  }

  const limit = await checkRateLimit(`export-full:${gate.userId}`, {
    limit: 5,
    windowSec: 10 * 60,
    failurePolicy: "deny",
  });
  if (!limit.allowed) {
    return jsonError("Çok fazla tam dışa aktarma isteği. Lütfen birkaç dakika sonra tekrar deneyin.", 429, {
      "Retry-After": "600",
    });
  }

  // B1: komisyon/denetim akışı yalnız earnings_all sahibine ofis geneli açılır.
  const seeAllEarnings =
    !gate.impersonating &&
    canSeeAllEarnings(await getEffectivePermissions(gate.tenantId, gate.role, gate.userId));

  const filename = `${def.filenameBase}-tam-${daysAgoIso(0).slice(0, 10)}.csv`;
  const supabase = await createClient();
  const opened = await openFullCsvStream({
    supabase,
    gate: { tenantId: gate.tenantId, userId: gate.userId, role: gate.role, seeAllEarnings },
    def,
    buildQuery: EXPORT_QUERIES[entity]!,
    onDone: async (summary) => {
      await logActivity({
        tenantId: gate.tenantId,
        actorId: gate.userId,
        action: "export.csv.full",
        entityType: entity,
        // Yalnız sayı/bayrak/dosya adı; satır içeriği audit'e girmez.
        newValue: { rows: summary.rows, truncated: summary.truncated, stopReason: summary.stopReason, filename },
      });
    },
  });
  if (!opened.ok) return jsonError("Dışa aktarma başarısız. Lütfen tekrar deneyin.", 500);

  return new Response(opened.stream, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
