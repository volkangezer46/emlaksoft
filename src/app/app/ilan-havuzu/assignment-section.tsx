import Link from "@/components/ui/smart-link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CheckCircle2, Clock, Layers } from "lucide-react";
import { AssignPanel } from "@/components/app/office-center/assign-panel";
import { AssignmentRowActions } from "@/components/app/office-center/assignment-row-actions";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableFrame, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatTry } from "@/lib/format";
import { ASSIGN_VIEWS, assignHref, parseAssignView, type AssignView } from "@/lib/office-center/logic";
import { loadPoolAssignmentHistory, loadUnassignedProperties } from "@/lib/office-center/store";
import type { AssignmentHistoryFilter } from "@/lib/office-center/types";
import { getSettings } from "@/lib/settings/read";
import { ASSIGN_SLA_HOURS_KEY } from "@/lib/settings/registry/tenant";

const dtf = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" });

export type AssignCtx = {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  role: string;
  nowMs: number;
  /** office_center edit: atama / iptal / yeniden atama. */
  canEdit: boolean;
  /** URL `?atama=` değeri (bozuksa "bekleyen"). */
  view: string;
};

/** Şube müdürü yalnız kendi şubesinin ilanlarını/danışmanlarını görür (sunucu eylemleri de aynı kuralı uygular). */
export async function assignBranchOf(ctx: Pick<AssignCtx, "supabase" | "tenantId" | "userId" | "role">): Promise<string | null> {
  if (ctx.role !== "branch_manager") return null;
  const { data } = await ctx.supabase.from("profiles").select("branch_id").eq("id", ctx.userId).eq("tenant_id", ctx.tenantId).maybeSingle();
  return (data as { branch_id?: string | null } | null)?.branch_id ?? null;
}

const METHOD_LABEL = { manual: "Elle", smart: "Akıllı", rule: "Kural" } as const;
const STATUS_LABEL = { active: "Aktif", cancelled: "İptal", reassigned: "Yeniden atandı" } as const;
/**
 * İLAN HAVUZU > Danışmansız ilanlar / Atama geçmişi (TEK atama ekranı; eskiden Ofis Merkezi > Atamalar sekmesiydi).
 * Danışmansız ilan + akıllı öneri (`smart-assign`, `AssignPanel`) + atama geçmişi (iptal / yeniden ata). Görünüm
 * URL'de (`?atama=`); sunucu sorgusu aynı değeri okur. Ofis Merkezi'nde yalnız özet KPI + buraya bağlantı kalır.
 */
export async function AssignmentSection({ ctx }: { ctx: AssignCtx }) {
  const durum: AssignView = parseAssignView(ctx.view);
  const showHistory = durum === "gecmis" || durum === "aktif" || durum === "iptal" || durum === "yeniden";
  const historyFilter: AssignmentHistoryFilter = durum === "aktif" ? "aktif" : durum === "iptal" ? "iptal" : durum === "yeniden" ? "yeniden" : "";

  const settings = await getSettings([ASSIGN_SLA_HOURS_KEY], { tenantId: ctx.tenantId });
  const slaHours = Number(settings[ASSIGN_SLA_HOURS_KEY] ?? 24);

  const branchId = await assignBranchOf(ctx);
  let advisorsQ = ctx.supabase.from("profiles").select("id, full_name, branch_id").eq("tenant_id", ctx.tenantId).eq("is_active", true).in("role", ["owner", "gm", "branch_manager", "team_lead", "advisor"]).order("full_name").limit(500);
  if (branchId) advisorsQ = advisorsQ.eq("branch_id", branchId);

  const [unassigned, advisorsRes, history] = await Promise.all([
    loadUnassignedProperties(ctx.supabase, ctx.tenantId, { nowMs: ctx.nowMs, slaHours, limit: 50, onlyBreached: durum === "gecikmis", branchId }),
    advisorsQ,
    showHistory
      ? loadPoolAssignmentHistory(ctx.supabase, ctx.tenantId, { filter: historyFilter, limit: 50, branchAdvisorIds: null })
      : loadPoolAssignmentHistory(ctx.supabase, ctx.tenantId, { filter: "", limit: 1 }),
  ]);
  const advisors = ((advisorsRes.data ?? []) as { id: string; full_name: string }[]).map((a) => ({ id: a.id, name: a.full_name }));
  const historyAvailable = history.available;

  return (
    <div className="space-y-5">
      <nav aria-label="Atama görünümü" className="flex flex-wrap gap-1">
        {ASSIGN_VIEWS.filter((v) => v.id !== "bekleyen" && v.id !== "gecikmis").map(({ id: v, label }) => (
          <Link
            key={v}
            href={assignHref(v)}
            aria-current={durum === v ? "page" : undefined}
            className={`focus-ring inline-flex min-h-8 items-center rounded-full px-3 text-sm font-medium transition ${durum === v ? "bg-brand-600 text-white" : "text-text-muted hover:bg-surface-hover hover:text-text"}`}
          >
            {label}
          </Link>
        ))}
      </nav>

      {!historyAvailable ? (
        <Alert tone="info" title="Atama geçmişi henüz etkin değil">
          Atama yapılabilir (ilan danışmana geçer, bildirim gider); geçmiş/iptal/yeniden atama kayıtları için veritabanı güncellemesi (pool_assignments) bekleniyor.
        </Alert>
      ) : null}
      {!unassigned.poolAvailable ? <p className="text-xs text-text-muted">İlan havuzu şeması yok: ilanlar doğrudan portföy kaydından listelenir.</p> : null}

      {!showHistory ? (
        unassigned.failed ? (
          <Alert tone="danger" title="İlanlar okunamadı">
            Danışmansız ilan listesi yüklenemedi; sayfayı yenileyin.
          </Alert>
        ) : unassigned.rows.length === 0 ? (
          <EmptyState
            illustration="portfoy"
            icon={CheckCircle2}
            title={durum === "gecikmis" ? "Geciken danışmansız ilan yok" : "Her ilanın danışmanı var"}
            description={durum === "gecikmis" ? `Tüm danışmansız ilanlar ${slaHours} saatlik sınırın içinde.` : "Yeni ilan danışmansız kalınca burada akıllı öneriyle listelenir."}
            tone="brand"
            action={{ href: "/app/portfoyler", label: "Portföylere git" }}
          />
        ) : (
          <ul className="space-y-3">
            {unassigned.rows.map((p) => (
              <li key={p.id} className={`rounded-[var(--radius-panel)] border bg-surface p-4 shadow-[var(--shadow-xs)] ${p.slaState === "breached" ? "border-danger-500/40" : p.slaState === "due_soon" ? "border-amber-400/50" : "border-line"}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link href={`/app/portfoyler/${p.id}`} className="font-display font-bold text-ink-950 hover:text-brand-600">
                      {p.title}
                    </Link>
                    <p className="text-xs text-text-muted">{[p.transactionType, p.propertyType, p.place].filter(Boolean).join(" · ") || "Konum bilgisi yok"}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    {p.listPrice != null ? <span className="numeric font-semibold text-ink-950">{formatTry(p.listPrice)}</span> : null}
                    <span className="inline-flex items-center gap-1 rounded-full bg-canvas px-2 py-0.5 font-semibold text-text-muted">
                      <Clock className="h-3 w-3" aria-hidden="true" /> {p.poolSince ? "havuzda" : "danışmansız"} {dtf.format(Date.parse(p.poolSince ?? p.createdAt))}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 font-semibold ${p.slaState === "breached" ? "bg-danger-500/10 text-danger-600" : p.slaState === "due_soon" ? "bg-amber-500/10 text-amber-700" : "bg-mint-500/10 text-mint-700"}`}>
                      {p.slaState === "breached" ? "Gecikti" : p.slaState === "due_soon" ? "Gecikmek üzere" : "Zamanında"}
                    </span>
                    {p.poolEntryId ? (
                      <Link href="/app/ilan-havuzu" className="font-semibold text-brand-600 hover:underline">
                        Havuzda bekliyor
                      </Link>
                    ) : null}
                  </div>
                </div>
                <div className="mt-3">
                  <AssignPanel propertyId={p.id} advisors={advisors} canAssign={ctx.canEdit} />
                </div>
              </li>
            ))}
            {unassigned.total > unassigned.rows.length ? <li className="text-xs text-text-muted">{unassigned.total} ilandan ilk {unassigned.rows.length} gösteriliyor (en eski önce).</li> : null}
          </ul>
        )
      ) : history.failed ? (
        <Alert tone="danger" title="Geçmiş okunamadı">
          Atama geçmişi yüklenemedi; sayfayı yenileyin.
        </Alert>
      ) : history.rows.length === 0 ? (
        <EmptyState icon={Layers} title="Kayıt yok" description={historyAvailable ? "Bu süzgeçte atama kaydı bulunmuyor. İlk atamayı danışmansız ilanlardan yapın." : "Geçmiş tablosu uygulanınca kayıtlar burada birikir."} action={{ href: assignHref(), label: "Danışmansız ilanlar" }} />
      ) : (
        <TableFrame minWidth={900} stack>
          <Table>
            <THead>
              <TR>
                <TH>İlan</TH>
                <TH>Danışman</TH>
                <TH>Yöntem · puan</TH>
                <TH>Gerekçe</TH>
                <TH>Durum</TH>
                <TH>Tarih</TH>
                {ctx.canEdit ? <TH>İşlem</TH> : null}
              </TR>
            </THead>
            <TBody>
              {history.rows.map((r) => (
                <TR key={r.id}>
                  <TD primary>
                    <Link href={`/app/portfoyler/${r.propertyId}`} className="font-semibold text-ink-950 hover:text-brand-600">
                      {r.propertyTitle}
                    </Link>
                  </TD>
                  <TD label="Danışman">
                    <Link href={`/app/ekip/${r.assignedTo}`} className="font-semibold text-ink-950 hover:text-brand-600">
                      {r.assignedToName}
                    </Link>
                    {r.previousAssigneeName ? <p className="text-xs text-text-muted">önceki: {r.previousAssigneeName}</p> : null}
                    <p className="text-xs text-text-faint">{r.assignedByName ? `atayan: ${r.assignedByName}` : "sistem"}</p>
                  </TD>
                  <TD label="Yöntem">
                    <span className="text-xs font-semibold text-ink-950">{METHOD_LABEL[r.method]}</span>
                    {r.scoreTotal != null ? <span className="numeric ml-1 rounded-full bg-ink-950 px-1.5 text-xs font-bold text-white">{r.scoreTotal}</span> : null}
                    {r.reasonSummary ? <p className="max-w-xs truncate text-xs text-text-muted" title={r.reasonSummary}>{r.reasonSummary}</p> : null}
                  </TD>
                  <TD label="Gerekçe">
                    <span className="text-xs text-text-muted">{r.reason ?? "—"}</span>
                    {r.cancelReason ? <p className="text-xs text-danger-600">İptal: {r.cancelReason}</p> : null}
                  </TD>
                  <TD>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${r.status === "active" ? "bg-mint-500/10 text-mint-700" : r.status === "cancelled" ? "bg-danger-500/10 text-danger-600" : "bg-canvas text-text-muted"}`}>{STATUS_LABEL[r.status]}</span>
                  </TD>
                  <TD label="Tarih">
                    <span className="text-xs text-text-muted">{dtf.format(Date.parse(r.createdAt))}</span>
                    {r.cancelledAt ? <p className="text-xs text-text-faint">iptal {dtf.format(Date.parse(r.cancelledAt))}</p> : null}
                  </TD>
                  {ctx.canEdit ? <TD actions>{r.status === "active" ? <AssignmentRowActions assignmentId={r.id} currentAdvisorId={r.assignedTo} advisors={advisors} /> : <span className="text-xs text-text-faint">—</span>}</TD> : null}
                </TR>
              ))}
            </TBody>
          </Table>
          {history.total > history.rows.length ? <p className="px-3 py-2 text-xs text-text-muted">{history.total} kayıttan ilk {history.rows.length} gösteriliyor.</p> : null}
        </TableFrame>
      )}
    </div>
  );
}
