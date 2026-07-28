import Link from "next/link";
import { ArrowLeft, ListChecks, Workflow } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { PLAYBOOK_TEMPLATES } from "@/lib/playbook-templates";
import type { PlaybookTriggerEvent } from "@/lib/playbook-engine";
import { PLAYBOOK_TRIGGER_LABELS } from "@/lib/playbook-labels";
import { PlaybooksManager, type PlaybookListRow, type StaffOption } from "./playbooks-manager";

export const metadata = { title: "İş akışları" };

type PlaybookRow = {
  id: string;
  name: string;
  description: string | null;
  trigger_event: string;
  filter: Record<string, string> | null;
  is_active: boolean;
};

type StepRow = {
  id: string;
  playbook_id: string;
  sort_order: number;
  title: string;
  kind: string;
  priority: string;
  offset_days: number;
  assign_to: string;
  assignee_id: string | null;
  note: string | null;
};

export default async function IsAkislariPage() {
  const { tenantId, perms } = await requireModulePage("settings");
  const canEdit = (perms.settings ?? []).includes("edit");
  const supabase = await createClient();

  const [{ data: playbookData }, { data: staffData }] = await Promise.all([
    supabase
      .from("playbooks")
      .select("id, name, description, trigger_event, filter, is_active")
      .eq("tenant_id", tenantId)
      .order("updated_at", { ascending: false })
      .limit(100),
    supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name"),
  ]);

  const playbooks = (playbookData ?? []) as PlaybookRow[];
  const ids = playbooks.map((p) => p.id);

  // Adımlar ve çalışma kayıtları TEK sorguda gelir, bellekte gruplanır (N+1 yok).
  const [{ data: stepData }, { data: runData }] = await Promise.all([
    ids.length
      ? supabase
          .from("playbook_steps")
          .select("id, playbook_id, sort_order, title, kind, priority, offset_days, assign_to, assignee_id, note")
          .in("playbook_id", ids)
          .order("sort_order", { ascending: true })
      : Promise.resolve({ data: [] as StepRow[] }),
    ids.length
      ? supabase.from("playbook_runs").select("playbook_id").in("playbook_id", ids).limit(5000)
      : Promise.resolve({ data: [] as { playbook_id: string }[] }),
  ]);

  const stepsByPlaybook = new Map<string, StepRow[]>();
  for (const s of (stepData ?? []) as StepRow[]) {
    const list = stepsByPlaybook.get(s.playbook_id) ?? [];
    list.push(s);
    stepsByPlaybook.set(s.playbook_id, list);
  }

  const runCounts = new Map<string, number>();
  for (const r of (runData ?? []) as { playbook_id: string }[]) {
    runCounts.set(r.playbook_id, (runCounts.get(r.playbook_id) ?? 0) + 1);
  }

  const rows: PlaybookListRow[] = playbooks.map((p) => {
    const filterEntries = p.filter && typeof p.filter === "object" ? Object.entries(p.filter) : [];
    const [filterKey, filterValue] = filterEntries[0] ?? ["", ""];
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      trigger_event: p.trigger_event,
      triggerLabel: PLAYBOOK_TRIGGER_LABELS[p.trigger_event as PlaybookTriggerEvent] ?? p.trigger_event,
      filterKey: String(filterKey ?? ""),
      filterValue: String(filterValue ?? ""),
      is_active: p.is_active,
      runCount: runCounts.get(p.id) ?? 0,
      steps: (stepsByPlaybook.get(p.id) ?? []).map((s) => ({
        title: s.title,
        kind: s.kind,
        priority: s.priority,
        offset_days: s.offset_days,
        assign_to: s.assign_to,
        assignee_id: s.assignee_id,
        note: s.note,
      })),
    };
  });

  const staff = ((staffData ?? []) as StaffOption[]).map((s) => ({ id: s.id, full_name: s.full_name }));
  const activeCount = rows.filter((r) => r.is_active).length;
  const totalSteps = rows.reduce((sum, r) => sum + r.steps.length, 0);

  const templates = PLAYBOOK_TEMPLATES.map((t) => ({
    key: t.key,
    name: t.name,
    description: t.description,
    triggerLabel: PLAYBOOK_TRIGGER_LABELS[t.trigger_event],
    stepCount: t.steps.length,
    lastOffset: t.steps.reduce((m, s) => Math.max(m, s.offset_days), 0),
  }));

  return (
    <div className="space-y-6">
      <Link
        href="/app/ayarlar"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted transition hover:text-brand-600"
      >
        <ArrowLeft className="h-4 w-4" /> Ayarlara dön
      </Link>

      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-4 text-white md:p-6">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-14 -top-16 h-60 w-60 rounded-full bg-brand-600/35 blur-[80px]" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="flex items-center gap-2 text-xs font-semibold text-mint-400">
              <Workflow className="h-4 w-4" /> İş akışı şablonları
            </span>
            <h1 className="mt-2 font-display text-2xl font-extrabold md:text-3xl">İş akışları</h1>
            <p className="mt-1 max-w-2xl text-sm text-white/60">
              Otomasyonlar tek bir aksiyon üretir; iş akışları ise bir olay gerçekleşince{" "}
              <strong className="font-semibold text-white/85">sıralı ve vadeli bir görev listesini</strong> tek
              seferde açar. Örneğin yeni satılık portföy alındığında tapu, fotoğraf, portal, komşu ve fiyat
              kontrolü görevleri kendiliğinden takvime düşer.
            </p>
          </div>
          <div className="flex gap-3">
            <div className="rounded-[14px] border border-white/12 bg-white/[0.05] px-5 py-3 text-center">
              <p className="font-display text-xl font-extrabold text-mint-300">{activeCount}</p>
              <p className="text-[11px] text-white/55">aktif akış</p>
            </div>
            <Link
              href="/app/gorevler"
              className="focus-ring press flex items-center gap-2.5 rounded-[14px] border border-white/12 bg-white/[0.05] px-5 py-3 transition hover:border-white/30"
            >
              <ListChecks className="h-5 w-5 text-brand-300" />
              <div className="text-left">
                <p className="font-display text-xl font-extrabold text-white">{totalSteps}</p>
                <p className="text-[11px] text-white/55">tanımlı adım</p>
              </div>
            </Link>
          </div>
        </div>
      </section>

      <PlaybooksManager playbooks={rows} staff={staff} templates={templates} canEdit={canEdit} />
    </div>
  );
}
