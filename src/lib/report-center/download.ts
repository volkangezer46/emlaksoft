/**
 * Rapor indirme uç mantığı (SUNUCU): kimlik + yetki + hız sınırı + onay kapısı + denetim kaydı + dosya üretimi.
 * `/api/app/rapor/[id]` ve `/api/admin/rapor/[id]` bu işlevi çağırır; iki uç aynı kuralları paylaşır.
 */
import { NextResponse } from "next/server";
import { logActivity } from "@/lib/activity";
import { fetchExternal } from "@/lib/external-fetch";
import { requestApprovalIfNeeded } from "@/lib/oversight/approval-gate";
import { logPlatformActivity } from "@/lib/platform-activity";
import { getPlatformStaff } from "@/lib/platform";
import { platformCanAccess } from "@/lib/platform-access";
import { checkRateLimit } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/require-permission";
import { buildPlatformContext, buildTenantContext } from "./context";
import { collectReport } from "./engine";
import { parseFilters } from "./filters";
import type { PdfLogo } from "./format/pdf";
import { getReport, platformReportAllowed, tenantReportAllowed } from "./registry";
import { renderReport } from "./render";
import { REPORT_FORMATS, REPORT_ROW_LIMITS, type Filters, type ReportContext, type ReportDef, type ReportFormat, type ReportScope } from "./types";

export const REPORT_EXPORT_ACTION = "export.report";
export const PLATFORM_REPORT_EXPORT_ACTION = "report.export";

function json(error: string, status: number, headers?: Record<string, string>) {
  return NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

/** Denetim kaydı için filtre özeti: serbest metin değerleri (ad/telefon olabilir) KAYDEDİLMEZ. */
export function auditFilterSummary(def: Pick<ReportDef, "filters">, filters: Filters): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of def.filters) {
    const v = filters[f.key];
    if (!v) continue;
    out[f.key] = f.kind === "text" ? "(metin)" : v;
  }
  return out;
}

/** Tenant logosu (yalnız Supabase depolama, PNG/JPEG, en çok 1 MB, 3 sn) — yoksa/hatalıysa PDF logosuz üretilir. */
async function fetchLogo(url: string | null): Promise<PdfLogo | null> {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || !u.hostname.endsWith(".supabase.co")) return null;
    const res = await fetchExternal(u, { method: "GET" }, { timeoutMs: 3_000 });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    const kind = type.includes("png") ? "png" : type.includes("jpeg") || type.includes("jpg") ? "jpg" : null;
    if (!kind) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    return buf.length > 0 && buf.length <= 1_000_000 ? { bytes: buf, kind } : null;
  } catch {
    return null;
  }
}

export type Authorized =
  | { ok: true; def: ReportDef; ctx: ReportContext & { logoUrl?: string | null }; actorId: string; actorName: string; tenantId: string | null }
  | { ok: false; status: number; error: string };

/** Kiracı raporu için kapılar: oturum → `reports` modülü → raporun kendi modülü → rol/kazanç kuralı. */
export async function authorizeTenantReport(id: string): Promise<Authorized> {
  const def = getReport("tenant", id);
  if (!def || !def.module) return { ok: false, status: 404, error: "Rapor bulunamadı." };
  const base = await requirePermission("reports", "view");
  if (!base.ok) return { ok: false, status: base.error === "Oturum bulunamadı." ? 401 : 403, error: base.error };
  const gate = await requirePermission(def.module, "view");
  if (!gate.ok) return { ok: false, status: 403, error: gate.error };
  const ctx = await buildTenantContext(gate);
  if (!tenantReportAllowed(def, { perms: ctx.perms, role: gate.role, officeWide: ctx.officeWide, seeAllEarnings: ctx.seeAllEarnings })) {
    return { ok: false, status: 403, error: "Bu rapor için yetkiniz yok." };
  }
  const { data: me } = await ctx.supabase.from("profiles").select("full_name").eq("id", gate.userId).eq("tenant_id", gate.tenantId).maybeSingle();
  return { ok: true, def, ctx, actorId: gate.userId, actorName: (me as { full_name?: string | null } | null)?.full_name ?? "", tenantId: gate.tenantId };
}

/** Platform raporu için kapılar: personel → `reports` departman modülü → raporun modülü. */
export async function authorizePlatformReport(id: string): Promise<Authorized> {
  const def = getReport("platform", id);
  if (!def || !def.platformModule) return { ok: false, status: 404, error: "Rapor bulunamadı." };
  const staff = await getPlatformStaff();
  if (!staff) return { ok: false, status: 401, error: "Oturum bulunamadı." };
  if (!platformCanAccess(staff.role, "reports") || !platformReportAllowed(def, staff.role)) {
    return { ok: false, status: 403, error: "Bu rapor için yetkiniz yok." };
  }
  return { ok: true, def, ctx: buildPlatformContext({ id: staff.id, role: staff.role }), actorId: staff.id, actorName: staff.full_name, tenantId: null };
}

export async function handleReportDownload(scope: ReportScope, id: string, req: Request): Promise<Response> {
  const url = new URL(req.url);
  const format = url.searchParams.get("format") as ReportFormat | null;
  if (!format || !REPORT_FORMATS.includes(format)) return json("Geçersiz dosya biçimi.", 400);

  const auth = scope === "tenant" ? await authorizeTenantReport(id) : await authorizePlatformReport(id);
  if (!auth.ok) return json(auth.error, auth.status);
  const { def, ctx } = auth;

  const parsed = parseFilters(def, url.searchParams);
  if (!parsed.ok) return json(parsed.error, 400);
  const filters = parsed.filters;

  const limit = await checkRateLimit(`report:${scope}:${auth.actorId}`, { limit: 20, windowSec: 10 * 60, failurePolicy: "deny" });
  if (!limit.allowed) return json("Çok fazla rapor isteği. Lütfen birkaç dakika sonra tekrar deneyin.", 429, { "Retry-After": "600" });

  // Ofis kontrol onay kapısı (varsayılan kapalı). Toplu dışa aktarma eşiği gerçek satır sayısıyla değerlendirilir.
  if (scope === "tenant" && auth.tenantId) {
    const probe = await collectReport(def, ctx, filters, { maxRows: 1 });
    if (!probe.ok) return json(probe.error, 500);
    const approval = await requestApprovalIfNeeded(auth.tenantId, auth.actorId, "bulk_export", { rows: probe.total, exportEntity: def.id, channel: "full" });
    if (approval.status !== "not_required" && approval.status !== "approved") return json(approval.message, 403);
  }

  const logo = format === "pdf" && scope === "tenant" ? await fetchLogo((ctx as { logoUrl?: string | null }).logoUrl ?? null) : null;
  const result = await renderReport({ format, def, ctx, filters, generatedBy: auth.actorName || undefined, logo });
  if (!result.ok) return json(result.error, 500);

  const summary = auditFilterSummary(def, filters);
  const auditValue = { report: def.id, title: def.title, format, rows: result.rowCount, total: result.total, truncated: result.truncated, stopReason: result.stopReason, filters: summary, filename: result.filename };
  if (scope === "tenant" && auth.tenantId) {
    await logActivity({ tenantId: auth.tenantId, actorId: auth.actorId, action: REPORT_EXPORT_ACTION, entityType: def.id, newValue: auditValue });
  } else {
    await logPlatformActivity({ actorId: auth.actorId, action: PLATFORM_REPORT_EXPORT_ACTION, entityType: def.id, meta: auditValue });
  }

  return new Response(result.body as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": result.contentType,
      "Content-Disposition": `attachment; filename="${result.filename}"; filename*=UTF-8''${encodeURIComponent(result.filename)}`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Report-Rows": String(result.rowCount),
      "X-Report-Truncated": result.truncated ? "1" : "0",
      "X-Report-Row-Limit": String(REPORT_ROW_LIMITS[format]),
    },
  });
}
