import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { SUBJECT_EXPORT_INTEGRITY_NOTE, subjectExportFileName, type SubjectExport } from "@/lib/compliance/subject-export";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * KVKK veri sahibi dökümünün makinece okunur kopyası (taşınabilirlik, KVKK md. 11 / GDPR md. 20). Rapor DEĞİLDİR:
 * talebe eklenmiş değişmez anlık görüntüdür; yalnız compliance:view (RLS aynı kuralı uygular). Her indirme işlem
 * kaydına düşer.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePermission("compliance", "view");
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: 403 });
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Geçersiz talep." }, { status: 400 });

  const supabase = await createClient();
  const { data } = await supabase
    .from("kvkk_subject_exports")
    .select("id, payload, payload_sha256")
    .eq("request_id", id)
    .eq("tenant_id", gate.tenantId)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return NextResponse.json({ error: "Bu talep için döküm bulunamadı." }, { status: 404 });

  const doc = data.payload as SubjectExport;
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "kvkk.subject_export_downloaded",
    entityType: "kvkk_request",
    entityId: id,
    newValue: { export_id: data.id, sha256: data.payload_sha256 },
  });
  const fileName = subjectExportFileName(doc);
  return new NextResponse(`${JSON.stringify({ ...doc, integrity: { sha256: data.payload_sha256, method: SUBJECT_EXPORT_INTEGRITY_NOTE } }, null, 2)}\n`, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
