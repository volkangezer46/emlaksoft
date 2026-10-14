import { notFound } from "next/navigation";
import Link from "@/components/ui/smart-link";
import { AlarmClock, Scale } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { now } from "@/lib/clock";
import { formatDateTimeTr } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { EIDS_LEGAL_NOTE, propertyLabel } from "@/lib/eids/actions-core";
import { TakedownChecklist, type ChecklistItem } from "./takedown-checklist";

export const metadata = { title: "İlan kaldırma görevi" };
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MANAGEMENT = new Set(["owner", "gm", "branch_manager"]);

/**
 * EİDS kaldırma görevi (kind=eids_takedown): görev özeti + yasal dayanak + kontrol listesi. Görev listesinden
 * (/app/gorevler?tur=eids_takedown) ve bildirimlerden açılır; RLS görev görme yetkisiyle sınırlar.
 */
export default async function EidsTakedownPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, ctx] = await Promise.all([params, requireModulePage("tasks", "/app/gorevler")]);
  if (!UUID_RE.test(id)) notFound();
  const canEdit = (ctx.perms.tasks ?? []).includes("edit");
  const supabase = await createClient();

  const [{ data: task }, { data: itemRows }, { data: clients }] = await Promise.all([
    supabase
      .from("tasks")
      .select("id, title, notes, status, kind, due_at, created_at, completed_at, escalated_at, property_id, assigned_to, assignee:profiles!tasks_assigned_to_fkey(full_name)")
      .eq("id", id)
      .eq("tenant_id", ctx.tenantId)
      .maybeSingle(),
    supabase
      .from("eids_takedown_items")
      .select("id, target, status, verified_by, done_at, portal_listing_id, created_at")
      .eq("tenant_id", ctx.tenantId)
      .eq("task_id", id)
      .order("created_at", { ascending: true }),
    supabase.from("verification_clients").select("id").eq("tenant_id", ctx.tenantId).is("revoked_at", null).limit(1),
  ]);
  if (!task || task.kind !== "eids_takedown") notFound();

  const rows = (itemRows ?? []) as { id: string; target: string; status: string; verified_by: string | null; done_at: string | null; portal_listing_id: string | null }[];
  const listingIds = rows.map((r) => r.portal_listing_id).filter((v): v is string => Boolean(v));
  const [{ data: listings }, { data: property }] = await Promise.all([
    listingIds.length
      ? supabase.from("portal_listings").select("id, portal_url").eq("tenant_id", ctx.tenantId).in("id", listingIds)
      : Promise.resolve({ data: [] as { id: string; portal_url: string | null }[] }),
    task.property_id
      ? supabase.from("properties").select("id, title, property_code").eq("id", task.property_id).eq("tenant_id", ctx.tenantId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const urlBy = new Map(((listings ?? []) as { id: string; portal_url: string | null }[]).map((l) => [l.id, l.portal_url]));
  const items: ChecklistItem[] = rows.map((r) => ({
    id: r.id,
    target: r.target,
    status: r.status,
    verified_by: r.verified_by,
    done_at: r.done_at,
    portal_url: r.portal_listing_id ? (urlBy.get(r.portal_listing_id) ?? null) : null,
  }));
  const assignee = Array.isArray(task.assignee) ? task.assignee[0]?.full_name : (task.assignee as { full_name?: string } | null)?.full_name;
  const open = task.status === "open";
  const overdue = open && task.due_at ? Date.parse(task.due_at) < now() : false;
  const prop = property as { id: string; title: string | null; property_code: string | null } | null;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Görevler · EİDS yetkisi"
        title={open ? "İlanı 3 gün içinde kaldırın" : task.status === "done" ? "Kaldırma görevi tamamlandı" : "Kaldırma görevi iptal edildi"}
        breadcrumbs={[{ label: "Görevler", href: "/app/gorevler?tur=eids_takedown" }, { label: "İlan kaldırma" }]}
        description={task.title}
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-[var(--radius-panel)] border border-line bg-surface p-4">
          <p className="text-xs font-medium text-text-muted">Portföy</p>
          {prop ? (
            <Link href={`/app/portfoyler/${prop.id}`} className="focus-ring mt-1 block truncate text-sm font-semibold text-brand-600 hover:underline">
              {propertyLabel(prop)}
            </Link>
          ) : (
            <p className="mt-1 text-sm text-text-muted">Portföy kaydı yok</p>
          )}
        </div>
        <div className={`rounded-[var(--radius-panel)] border p-4 ${overdue ? "border-danger-500/40 bg-danger-500/5" : "border-line bg-surface"}`}>
          <p className="flex items-center gap-1 text-xs font-medium text-text-muted">
            <AlarmClock aria-hidden="true" className="h-3.5 w-3.5" /> Son gün
          </p>
          <p className={`mt-1 text-sm font-semibold ${overdue ? "text-danger-600" : "text-ink-950"}`}>
            {task.due_at ? formatDateTimeTr(task.due_at) : "—"}
            {overdue ? " · gecikti" : ""}
          </p>
          {task.escalated_at ? <p className="mt-1 text-xs text-danger-600">Ofis sahibine yükseltildi: {formatDateTimeTr(task.escalated_at)}</p> : null}
        </div>
        <div className="rounded-[var(--radius-panel)] border border-line bg-surface p-4">
          <p className="text-xs font-medium text-text-muted">Sorumlu</p>
          <p className="mt-1 text-sm font-semibold text-ink-950">{assignee ?? "Atanmamış"}</p>
        </div>
      </div>

      <div className="flex gap-3 rounded-[var(--radius-panel)] border border-danger-500/25 bg-danger-500/5 p-4">
        <Scale aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-danger-600" />
        <div className="space-y-1 text-sm text-ink-950">
          <p className="font-semibold">Yasal dayanak</p>
          <p className="text-text-muted">{EIDS_LEGAL_NOTE}</p>
        </div>
      </div>

      {items.length === 0 ? (
        <p className="rounded-[var(--radius-panel)] border border-line bg-surface p-4 text-sm text-text-muted">
          Bu görevin kontrol listesi oluşturulamadı. Sayfayı yenileyin; sürerse destek ekibine yazın.
        </p>
      ) : (
        <TakedownChecklist
          taskId={task.id}
          items={items}
          open={open}
          canEdit={canEdit}
          canRestore={MANAGEMENT.has(ctx.role)}
          hasExtension={(clients ?? []).length > 0}
        />
      )}
    </div>
  );
}
