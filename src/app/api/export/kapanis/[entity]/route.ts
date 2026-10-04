import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { logActivity } from "@/lib/activity";
import { closureDownloadAllowed } from "@/lib/admin/office-closure";
import { EXPORT_ENTITIES, isFullExportEntity } from "@/lib/export-entities";
import { EXPORT_QUERIES, openFullCsvStream } from "@/lib/export-full";
import { daysAgoIso } from "@/lib/clock";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

function jsonError(error: string, status: number, headers?: Record<string, string>) {
  return NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

/**
 * GET /api/export/kapanis/[entity] — ARŞİVLENMİŞ (iptal) ofisin SAHİBİ için veri paketi (CSV, varlık başına).
 * Normal dışa aktarma rotası askıdaki/iptal ofiste tenant-guard ile kapalıdır; bu rota yalnız şu koşullarda açılır:
 * oturum açmış gerçek ofis sahibi (destek oturumu değil) + ofis durumu 'cancelled' + platformun "tamamlandı" yaptığı
 * (kapatma işlenmiş) bir hesap kapatma/veri indirme talebi. Veri RLS'li oturum istemcisiyle okunur (service_role YOK); platform personeli
 * müşteri verisini okumaz. Kalıcı silme yoktur; bu yalnız okuma/indirme.
 */
export async function GET(req: Request, { params }: { params: Promise<{ entity: string }> }) {
  const { entity } = await params;
  if (!isFullExportEntity(entity) || !EXPORT_QUERIES[entity]) return jsonError("Bilinmeyen dışa aktarma türü.", 404);
  const def = EXPORT_ENTITIES[entity]!;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Oturum bulunamadı.", 401);
  if (user.app_metadata?.impersonating === true) return jsonError("Destek oturumunda indirilemez.", 403);

  const { data: profile } = await supabase
    .from("profiles")
    .select("tenant_id, role, is_active")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.is_active || profile.role !== "owner" || !profile.tenant_id) {
    return jsonError("Bu paketi yalnız ofis sahibi indirebilir.", 403);
  }
  const tenantId = String(profile.tenant_id);

  const [{ data: tenant }, { data: requests }] = await Promise.all([
    supabase.from("tenants").select("status").eq("id", tenantId).maybeSingle(),
    supabase
      .from("kvkk_requests")
      .select("status")
      .eq("tenant_id", tenantId)
      .in("request_type", ["account_closure", "data_export"]),
  ]);
  if (!closureDownloadAllowed(tenant?.status, (requests ?? []).map((r) => String(r.status)))) {
    return jsonError("Veri paketi yalnız arşivlenmiş ofis için, hesap kapatma talebi sonrası indirilebilir.", 403);
  }

  const limit = await checkRateLimit(`export-closure:${user.id}`, {
    limit: 20,
    windowSec: 10 * 60,
    failurePolicy: "deny",
  });
  if (!limit.allowed) {
    return jsonError("Çok fazla indirme isteği. Lütfen birkaç dakika sonra tekrar deneyin.", 429, {
      "Retry-After": "600",
    });
  }

  const filename = `${def.filenameBase}-ofis-paketi-${daysAgoIso(0).slice(0, 10)}.csv`;
  const opened = await openFullCsvStream({
    supabase,
    gate: { tenantId, userId: user.id, role: "owner", seeAllEarnings: true },
    def,
    buildQuery: EXPORT_QUERIES[entity]!,
    params: new URL(req.url).searchParams,
    onDone: async (summary) => {
      await logActivity({
        tenantId,
        actorId: user.id,
        action: "export.closure_package",
        entityType: entity,
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
