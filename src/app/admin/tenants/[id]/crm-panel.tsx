"use client";

import Link from "@/components/ui/smart-link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CheckCircle2, Circle, ClipboardList, HeartPulse, ListTodo, Pencil, Pin, PinOff, Plus, StickyNote, Trash2 } from "lucide-react";
import {
  createPlatformTask,
  deletePlatformTask,
  deleteTenantCrmNote,
  saveTenantCrmNote,
  setPlatformTaskDone,
  setTenantAccountOwner,
  setTenantCrmNotePinned,
  setTenantLifecycleStage,
  setTenantTags,
} from "@/app/actions/platform-crm";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterChip } from "@/components/ui/filter-chip";
import { Input, Textarea } from "@/components/ui/input";
import { PersonSelect } from "@/components/ui/person-select";
import { HEALTH_BAND_LABELS, HEALTH_BAND_TONE, healthBand, type HealthBand } from "@/lib/admin/health-score";
import {
  LIFECYCLE_LABELS,
  LIFECYCLE_STAGES,
  LIFECYCLE_TONE,
  NOTE_CATEGORIES,
  NOTE_CATEGORY_LABELS,
  type CrmNoteView,
  type CrmStaff,
  type CrmTag,
  type CrmTaskView,
  type HealthPoint,
  type LifecycleStage,
  type NoteCategory,
} from "@/lib/admin/platform-crm";
import { cn } from "@/lib/utils";
import { TagBadge } from "../crm-toolbar";

/**
 * Ofis 360 CRM yüzeyi (AD5):
 *  - `CrmHeaderStrip`: başlıkta sağlık skoru rozeti, yaşam döngüsü aşaması, sorumlu personel, etiketler ve
 *    "Görevlerim" kutusu (oturumdaki personelin açık görevleri; bu ofisinkiler önce).
 *  - `CrmRelationTab`: "İlişki" sekmesi — yapılandırılmış notlar (kategori, sabitleme, düzenleme), takip görevleri
 *    (hatırlatma tarihi; vadesi gelince sorumlunun bildirim kutusuna düşer) ve 30 günlük sağlık skoru trendi.
 * Saat okunmaz: tüm tarih etiketleri ve gecikme bayrağı sunucuda hesaplanır (`taskView`/`noteView`).
 */

const SELECT_CLS =
  "min-h-8 touch:min-h-11 rounded-[var(--radius-control)] border border-line bg-canvas px-2 text-sm text-text outline-none transition focus:border-brand-400 focus:bg-surface disabled:opacity-60";

const ROLE_HINT: Record<string, string> = { super_admin: "Süper admin", ops: "Operasyon", support: "Destek", billing: "Muhasebe" };
const peopleOf = (staff: CrmStaff[], meId: string) => staff.map((s) => ({ id: s.id, name: s.id === meId ? `${s.name} (ben)` : s.name, hint: ROLE_HINT[s.role] ?? s.role }));

type Notice = { tone: "ok" | "error"; text: string } | null;

function NoticeLine({ notice }: { notice: Notice }) {
  if (!notice) return null;
  return (
    <p role={notice.tone === "error" ? "alert" : "status"} className={cn("text-xs font-semibold", notice.tone === "error" ? "text-[var(--pm-danger-text)]" : "text-[var(--pm-success-text)]")}>
      {notice.text}
    </p>
  );
}

function useCrmAction() {
  const router = useRouter();
  const [notice, setNotice] = useState<Notice>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok?: boolean; error?: string; message?: string }>, after?: () => void) => {
    setNotice(null);
    start(async () => {
      const r = await fn();
      if (r.ok) {
        setNotice(r.message ? { tone: "ok", text: r.message } : null);
        after?.();
        router.refresh();
      } else setNotice({ tone: "error", text: r.error ?? "İşlem yapılamadı." });
    });
  };
  return { notice, pending, run };
}

export function HealthScoreBadge({ score, threshold, href }: { score: number | null; threshold: number; href?: string }) {
  if (score === null) {
    return (
      <span className="adm-badge pm-t-neutral" title="Sağlık skoru günlük hesaplanır; bu ofis için henüz hesaplanmadı">
        <HeartPulse aria-hidden="true" /> Skor hesaplanmadı
      </span>
    );
  }
  const band: HealthBand = healthBand(score, threshold);
  const content = (
    <>
      <HeartPulse aria-hidden="true" /> Sağlık {score}/100 · {HEALTH_BAND_LABELS[band]}
    </>
  );
  const cls = `adm-badge pm-t-${HEALTH_BAND_TONE[band]} tabular-nums`;
  return href ? (
    <Link href={href} className={`${cls} focus-ring`} title="Skor ayrıntısı ve trendi">
      {content}
    </Link>
  ) : (
    <span className={cls}>{content}</span>
  );
}

export function CrmHeaderStrip({
  tenantId,
  score,
  threshold,
  stage,
  stageAuto,
  ownerId,
  tagIds,
  tags,
  staff,
  myTasks,
  meId,
  canEdit,
  relationHref,
}: {
  tenantId: string;
  score: number | null;
  threshold: number;
  stage: LifecycleStage;
  stageAuto: boolean;
  ownerId: string | null;
  tagIds: string[];
  tags: CrmTag[];
  staff: CrmStaff[];
  myTasks: CrmTaskView[];
  meId: string;
  canEdit: boolean;
  relationHref: string;
}) {
  const { notice, pending, run } = useCrmAction();
  const [editTags, setEditTags] = useState(false);
  const [draftTags, setDraftTags] = useState<string[]>(tagIds);
  const tagById = new Map(tags.map((t) => [t.id, t]));
  const current = tagIds.map((id) => tagById.get(id)).filter((t): t is CrmTag => Boolean(t));

  return (
    <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <section aria-label="Ofis CRM özeti" className="rounded-[var(--radius-card)] border border-line bg-surface p-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <HealthScoreBadge score={score} threshold={threshold} href={relationHref} />
          <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-text-muted">
            Aşama
            <select
              className={SELECT_CLS}
              value={stageAuto ? "" : stage}
              disabled={!canEdit || pending}
              onChange={(e) => run(() => setTenantLifecycleStage(tenantId, e.target.value || null))}
              aria-label="Yaşam döngüsü aşaması"
            >
              <option value="">Otomatik ({LIFECYCLE_LABELS[stage]})</option>
              {LIFECYCLE_STAGES.map((s) => (
                <option key={s} value={s}>
                  {LIFECYCLE_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <span className={`adm-badge pm-t-${LIFECYCLE_TONE[stage]}`}>{LIFECYCLE_LABELS[stage]}</span>
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-text-muted">
            Sorumlu
            <PersonSelect
              people={ownerId && !staff.some((s) => s.id === ownerId) ? [...peopleOf(staff, meId), { id: ownerId, name: "Pasif personel", active: false }] : peopleOf(staff, meId)}
              featuredIds={[meId]}
              value={ownerId ?? ""}
              emptyLabel="Atanmamış"
              clearable
              disabled={!canEdit || pending}
              onValueChange={(v) => run(() => setTenantAccountOwner(tenantId, v || null))}
              aria-label="Sorumlu personel"
              className="min-w-[11rem]"
            />
          </span>
          {canEdit && ownerId !== meId ? (
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setTenantAccountOwner(tenantId, meId))}>
              Bana ata
            </Button>
          ) : null}
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-semibold text-text-faint">Etiketler:</span>
          {current.length ? current.map((t) => <TagBadge key={t.id} tag={t} href={`/admin/tenants?etiket=${t.id}`} />) : <span className="text-xs text-text-muted">Etiket yok</span>}
          {canEdit && tags.length ? (
            <Button size="sm" variant="ghost" onClick={() => { setDraftTags(tagIds); setEditTags((v) => !v); }} aria-expanded={editTags}>
              {editTags ? "Kapat" : "Düzenle"}
            </Button>
          ) : null}
        </div>
        {editTags ? (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-[var(--radius-control)] border border-line p-2">
            {tags.map((t) => {
              const on = draftTags.includes(t.id);
              return (
                <FilterChip key={t.id} active={on} onClick={() => setDraftTags((cur) => (on ? cur.filter((x) => x !== t.id) : [...cur, t.id]))}>
                  <span className={`adm-badge pm-t-${t.color}`}>{t.name}</span>
                </FilterChip>
              );
            })}
            <Button size="sm" loading={pending} onClick={() => run(() => setTenantTags(tenantId, draftTags), () => setEditTags(false))}>
              Kaydet
            </Button>
          </div>
        ) : null}
        <div className="mt-1.5">
          <NoticeLine notice={notice} />
        </div>
      </section>

      <section aria-label="Görevlerim" className="rounded-[var(--radius-card)] border border-line bg-surface p-3.5">
        <h2 className="flex items-center gap-1.5 text-sm font-bold text-heading">
          <ListTodo className="h-4 w-4 text-brand-600" aria-hidden="true" /> Görevlerim
          <span className="ml-auto text-xs font-semibold text-text-muted">{myTasks.length ? `${myTasks.length} açık` : ""}</span>
        </h2>
        {myTasks.length === 0 ? (
          <p className="mt-2 text-xs text-text-muted">
            Açık göreviniz yok. <Link href={relationHref} className="font-semibold text-accent-text hover:underline">Bu ofis için görev ekleyin</Link>.
          </p>
        ) : (
          <ul className="mt-2 space-y-1">
            {[...myTasks]
              .sort((a, b) => Number(b.tenantId === tenantId) - Number(a.tenantId === tenantId))
              .slice(0, 5)
              .map((t) => (
                <li key={t.id} className="flex items-center gap-2 text-sm">
                  <Circle className={cn("h-3.5 w-3.5 shrink-0", t.overdue ? "text-[var(--pm-danger-text)]" : "text-text-faint")} aria-hidden="true" />
                  <Link
                    href={t.tenantId ? `/admin/tenants/${t.tenantId}?sekme=iliski` : relationHref}
                    className="focus-ring min-w-0 flex-1 truncate rounded-sm font-semibold hover:text-accent-text"
                    title={t.title}
                  >
                    {t.title}
                    {t.tenantId && t.tenantId !== tenantId && t.tenantName ? <span className="font-normal text-text-muted"> · {t.tenantName}</span> : null}
                  </Link>
                  {t.dueLabel ? <span className={cn("shrink-0 text-xs", t.overdue ? "font-semibold text-[var(--pm-danger-text)]" : "text-text-muted")}>{t.dueLabel}</span> : null}
                </li>
              ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// İlişki sekmesi
// ---------------------------------------------------------------------------

export function CrmRelationTab({
  tenantId,
  ready,
  notes,
  tasks,
  trend,
  staff,
  meId,
  canEdit,
  isSuper,
  threshold,
}: {
  tenantId: string;
  ready: boolean;
  notes: CrmNoteView[];
  tasks: CrmTaskView[];
  trend: HealthPoint[];
  staff: CrmStaff[];
  meId: string;
  canEdit: boolean;
  isSuper: boolean;
  threshold: number;
}) {
  if (!ready) {
    return (
      <section className="dashboard-panel rounded-[var(--radius-panel)] border border-line bg-surface p-5">
        <EmptyState variant="compact" bare icon={ClipboardList} title="Ofis CRM kurulumu bekliyor" description="Notlar, görevler ve sağlık skoru veritabanı güncellemesi uygulanınca burada açılır." />
      </section>
    );
  }
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
      <NotesPanel tenantId={tenantId} notes={notes} canEdit={canEdit} meId={meId} isSuper={isSuper} />
      <div className="space-y-4">
        <TasksPanel tenantId={tenantId} tasks={tasks} staff={staff} meId={meId} canEdit={canEdit} />
        <HealthTrend trend={trend} threshold={threshold} />
      </div>
    </div>
  );
}

function NotesPanel({ tenantId, notes, canEdit, meId, isSuper }: { tenantId: string; notes: CrmNoteView[]; canEdit: boolean; meId: string; isSuper: boolean }) {
  const { notice, pending, run } = useCrmAction();
  const [body, setBody] = useState("");
  const [category, setCategory] = useState<NoteCategory>("genel");
  const [pinned, setPinned] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [filter, setFilter] = useState<NoteCategory | "">("");

  function reset() {
    setBody("");
    setCategory("genel");
    setPinned(false);
    setEditing(null);
  }
  function submit() {
    const fd = new FormData();
    if (editing) fd.set("id", editing);
    fd.set("tenant_id", tenantId);
    fd.set("category", category);
    fd.set("body", body);
    fd.set("pinned", pinned ? "1" : "0");
    run(() => saveTenantCrmNote(fd), reset);
  }
  const shown = filter ? notes.filter((n) => n.category === filter) : notes;

  return (
    <section className="dashboard-panel rounded-[var(--radius-panel)] border border-line bg-surface">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3.5">
        <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
          <StickyNote className="h-4 w-4 text-brand-600" aria-hidden="true" /> Notlar
        </h2>
        <div className="ml-auto flex flex-wrap gap-1" role="group" aria-label="Kategoriye göre süz">
          {(["", ...NOTE_CATEGORIES] as const).map((c) => (
            <FilterChip key={c || "tum"} active={filter === c} onClick={() => setFilter(c)} count={c ? notes.filter((n) => n.category === c).length : notes.length}>
              {c ? NOTE_CATEGORY_LABELS[c] : "Tümü"}
            </FilterChip>
          ))}
        </div>
      </div>
      <div className="space-y-3 p-5">
        {canEdit ? (
          <form
            className="grid gap-2 rounded-[var(--radius-card)] border border-line p-3"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={2000} placeholder="Görüşme özeti, teknik not, ticari durum…" aria-label="Not metni" />
            <div className="flex flex-wrap items-center gap-2">
              <select className={SELECT_CLS} value={category} onChange={(e) => setCategory(e.target.value as NoteCategory)} aria-label="Kategori">
                {NOTE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {NOTE_CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
              <label className="inline-flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} className="h-4 w-4 accent-accent" /> Sabitle
              </label>
              <Button type="submit" size="sm" icon={editing ? Pencil : Plus} loading={pending} disabled={body.trim().length < 3} className="ml-auto">
                {editing ? "Güncelle" : "Not ekle"}
              </Button>
              {editing ? (
                <Button size="sm" variant="ghost" onClick={reset}>
                  Vazgeç
                </Button>
              ) : null}
            </div>
            <NoticeLine notice={notice} />
          </form>
        ) : null}
        {shown.length === 0 ? (
          <EmptyState variant="compact" bare icon={StickyNote} title={filter ? "Bu kategoride not yok" : "Henüz not yok"} description="Görüşmeleri ve kararları buraya yazın; ofis kullanıcıları bu notları göremez." />
        ) : (
          <ul className="space-y-2">
            {shown.map((n) => (
              <li key={n.id} className={cn("rounded-[var(--radius-card)] border p-3", n.pinned ? "border-[var(--pm-warn-text)]/40 bg-[var(--pm-warn-bg,transparent)]" : "border-line")}>
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-text-muted">
                  {n.pinned ? <Pin className="h-3.5 w-3.5 text-[var(--pm-warn-text)]" aria-label="Sabitlendi" /> : null}
                  <span className="adm-badge pm-t-neutral">{NOTE_CATEGORY_LABELS[n.category]}</span>
                  <span>{n.authorName ?? "Personel"}</span>
                  <span>· {n.createdLabel}</span>
                  {n.editedLabel ? <span>· düzenlendi {n.editedLabel}</span> : null}
                  {canEdit ? (
                    <span className="ml-auto inline-flex gap-0.5">
                      <Button size="icon" variant="ghost" icon={n.pinned ? PinOff : Pin} disabled={pending} aria-label={n.pinned ? "Sabitlemeyi kaldır" : "Sabitle"} onClick={() => run(() => setTenantCrmNotePinned(n.id, !n.pinned))} />
                      <Button
                        size="icon"
                        variant="ghost"
                        icon={Pencil}
                        aria-label="Düzenle"
                        onClick={() => {
                          setEditing(n.id);
                          setBody(n.body);
                          setCategory(n.category);
                          setPinned(n.pinned);
                        }}
                      />
                      {isSuper || n.authorId === meId ? (
                        <ConfirmDialog
                          trigger={<Button size="icon" variant="ghost" icon={Trash2} aria-label="Notu sil" />}
                          title="Not silinsin mi?"
                          description="Silinen not geri alınamaz; silme işlemi denetim kaydına yazılır."
                          confirmLabel="Notu sil"
                          onConfirm={() => run(() => deleteTenantCrmNote(n.id))}
                        />
                      ) : null}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1.5 whitespace-pre-wrap text-sm text-text">{n.body}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function TasksPanel({ tenantId, tasks, staff, meId, canEdit }: { tenantId: string; tasks: CrmTaskView[]; staff: CrmStaff[]; meId: string; canEdit: boolean }) {
  const { notice, pending, run } = useCrmAction();
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [assignee, setAssignee] = useState(meId);
  const open = tasks.filter((t) => t.status === "open");
  const done = tasks.filter((t) => t.status === "done");

  function submit() {
    const fd = new FormData();
    fd.set("tenant_id", tenantId);
    fd.set("title", title);
    fd.set("due_at", due);
    fd.set("assignee", assignee);
    run(() => createPlatformTask(fd), () => {
      setTitle("");
      setDue("");
    });
  }

  const row = (t: CrmTaskView) => (
    <li key={t.id} className="flex items-start gap-2 py-1.5">
      <Button
        size="icon"
        variant="ghost"
        disabled={!canEdit || pending}
        onClick={() => run(() => setPlatformTaskDone(t.id, t.status !== "done"))}
        aria-label={t.status === "done" ? `Yeniden aç: ${t.title}` : `Tamamla: ${t.title}`}
        className={t.status === "done" ? "text-[var(--pm-success-text)]" : t.overdue ? "text-[var(--pm-danger-text)]" : undefined}
        icon={t.status === "done" ? CheckCircle2 : Circle}
      />
      <div className="min-w-0 flex-1">
        <p className={cn("text-sm font-semibold", t.status === "done" && "text-text-muted line-through")}>{t.title}</p>
        <p className="text-xs text-text-muted">
          {t.assigneeName ?? "Atanmamış"}
          {t.dueLabel ? <span className={cn(t.overdue && "font-semibold text-[var(--pm-danger-text)]")}> · {t.overdue ? "gecikti: " : "hatırlatma: "}{t.dueLabel}</span> : null}
        </p>
      </div>
      {canEdit ? (
        <ConfirmDialog
          trigger={<Button size="icon" variant="ghost" icon={Trash2} aria-label={`Görevi sil: ${t.title}`} />}
          title="Görev silinsin mi?"
          description="Silinen görev geri alınamaz."
          confirmLabel="Görevi sil"
          onConfirm={() => run(() => deletePlatformTask(t.id))}
        />
      ) : null}
    </li>
  );

  return (
    <section className="dashboard-panel rounded-[var(--radius-panel)] border border-line bg-surface">
      <div className="flex items-center gap-2 border-b border-line px-5 py-3.5">
        <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
          <ListTodo className="h-4 w-4 text-brand-600" aria-hidden="true" /> Takip görevleri
        </h2>
        <span className="ml-auto text-xs font-semibold text-text-muted">{open.length} açık</span>
      </div>
      <div className="space-y-3 p-5">
        {canEdit ? (
          <form
            className="grid gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} placeholder="Görev (ör. Kurulum görüşmesi yap)" aria-label="Görev başlığı" />
            <div className="flex flex-wrap items-center gap-2">
              <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Hatırlatma tarihi (Türkiye saati)" className={SELECT_CLS} />
              <PersonSelect
                people={peopleOf(staff, meId)}
                featuredIds={[meId]}
                value={assignee}
                onValueChange={(v) => setAssignee(v || meId)}
                emptyLabel="Sorumlu seçin"
                aria-label="Görev sorumlusu"
                className="min-w-[11rem]"
              />
              <Button type="submit" size="sm" icon={Plus} loading={pending} disabled={title.trim().length < 2} className="ml-auto">
                Görev ekle
              </Button>
            </div>
            <p className="text-xs text-text-faint">Hatırlatma zamanı gelince görev sorumlunun bildirim kutusuna düşer.</p>
            <NoticeLine notice={notice} />
          </form>
        ) : null}
        {tasks.length === 0 ? (
          <p className="text-sm text-text-muted">Bu ofis için görev yok.</p>
        ) : (
          <>
            <ul className="divide-y divide-[var(--hairline)]">{open.map(row)}</ul>
            {done.length ? (
              <details>
                <summary className="cursor-pointer text-xs font-semibold text-text-muted">Tamamlanan ({done.length})</summary>
                <ul className="divide-y divide-[var(--hairline)]">{done.map(row)}</ul>
              </details>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

function HealthTrend({ trend, threshold }: { trend: HealthPoint[]; threshold: number }) {
  const last = trend[trend.length - 1];
  return (
    <section className="dashboard-panel rounded-[var(--radius-panel)] border border-line bg-surface">
      <div className="flex items-center gap-2 border-b border-line px-5 py-3.5">
        <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
          <HeartPulse className="h-4 w-4 text-brand-600" aria-hidden="true" /> Sağlık skoru · son 30 gün
        </h2>
      </div>
      <div className="p-5">
        {!last ? (
          <p className="text-sm text-text-muted">Skor her gün otomatik hesaplanır; ilk hesaplamadan sonra trend burada görünür.</p>
        ) : (
          <>
            <div className="flex h-16 items-end gap-[3px]" role="img" aria-label={`Son ${trend.length} günün sağlık skoru; en son ${last.score}`}>
              {trend.map((p) => {
                const band = healthBand(p.score, threshold);
                return (
                  <span
                    key={p.day}
                    title={`${p.day}: ${p.score}`}
                    className="min-w-[4px] flex-1 rounded-t-[3px]"
                    style={{ height: `${Math.max(6, p.score)}%`, background: band === "riskli" ? "var(--viz-neg)" : band === "izlenmeli" ? "var(--viz-gold)" : "var(--viz-pos)" }}
                  />
                );
              })}
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
              {(
                [
                  ["Kullanım", last.usage],
                  ["Ödeme", last.payment],
                  ["Destek", last.support],
                ] as const
              ).map(([label, v]) => (
                <div key={label} className="rounded-[var(--radius-control)] border border-line px-2 py-1.5">
                  <dt className="text-xs text-text-muted">{label}</dt>
                  <dd className="font-display text-lg font-bold tabular-nums text-heading">{v}</dd>
                </div>
              ))}
            </dl>
            {last.reasons.length ? (
              <ul className="mt-3 space-y-1 text-xs text-text-muted">
                {last.reasons.map((r) => (
                  <li key={r}>• {r}</li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
