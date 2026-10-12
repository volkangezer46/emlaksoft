"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "@/components/ui/smart-link";
import { ArrowDownRight, CalendarPlus, ExternalLink, Home, ListPlus, NotebookPen, Phone, PhoneOff, Repeat, UserCheck, XCircle } from "lucide-react";
import { buttonClass, Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormField, FormInput, FormSelect, FormTextarea } from "@/components/ui/form-controls";
import { PersonSelect, type PersonOption } from "@/components/ui/person-select";
import { StatusPill } from "@/components/ui/list-kit";
import { useToast } from "@/components/app/toast-provider";
import {
  addFsboNote,
  assignFsboLead,
  changeFsboStatus,
  createFsboTask,
  logFsboCall,
  markFsboDoNotCall,
  removeFsboDoNotCall,
  startFsboAppointment,
  type ProspectingResult,
} from "@/app/actions/prospecting";
import {
  FSBO_LOST_REASONS,
  FSBO_OUTCOMES,
  LOST_REASON_LABELS,
  OUTCOME_LABELS,
  PORTAL_LABELS,
  STATUS_LABELS,
} from "@/lib/prospecting/types";
import type { ScriptSection } from "@/lib/prospecting/script";
import type { FsboCardData } from "@/lib/prospecting/view";

type Panel = null | "call" | "note" | "task" | "lost" | "yetki" | "assign";

const PANEL_CLASS = "mt-3 rounded-[var(--radius-card)] border border-line bg-canvas/60 p-3";
const SMALL = "xs" as const;

export function FsboCard({
  data,
  canEdit,
  canDelete,
  canConvert,
  isManager,
  people,
  script,
  callNotice,
  dayDefault,
}: {
  data: FsboCardData;
  canEdit: boolean;
  canDelete: boolean;
  canConvert: boolean;
  isManager: boolean;
  people: readonly PersonOption[];
  script: ScriptSection[];
  callNotice: string;
  /** Görev/sonra-ara için varsayılan tarih (sunucu hesaplar: yarın). */
  dayDefault: string;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, start] = useTransition();
  const [panel, setPanel] = useState<Panel>(null);
  const [outcome, setOutcome] = useState<string>("gorusuldu");
  const [assignee, setAssignee] = useState<string>(data.assignedTo ?? "");
  const closed = data.status === "portfoye_donustu";
  const locked = data.doNotCall || closed;
  const lostLike = data.status === "kayip";

  function run(fn: () => Promise<ProspectingResult>, okMessage: string, after?: (r: ProspectingResult) => void) {
    start(async () => {
      const r = await fn();
      if (r.error) {
        push(r.error, "err");
        return;
      }
      push(okMessage, "ok");
      (r.notices ?? []).forEach((n) => push(n, "info"));
      setPanel(null);
      after?.(r);
      router.refresh();
    });
  }

  const toggle = (p: Exclude<Panel, null>) => setPanel((cur) => (cur === p ? null : p));

  return (
    <article className="surface-card rounded-[var(--radius-panel)] p-4" aria-label={data.title}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Link href={`/app/portfoy-avi/${data.id}`} className="focus-ring line-clamp-2 text-sm font-semibold text-ink-950 hover:underline">
            {data.title}
          </Link>
          <p className="mt-0.5 text-xs text-text-muted">
            {PORTAL_LABELS[data.portal]} · {data.place}
            {data.specs ? ` · ${data.specs}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusPill tone={closed ? "success" : lostLike ? "neutral" : data.status === "yeni" ? "info" : "warning"}>
            {STATUS_LABELS[data.status]}
            {lostLike && data.lostReason ? ` · ${LOST_REASON_LABELS[data.lostReason as keyof typeof LOST_REASON_LABELS] ?? data.lostReason}` : ""}
          </StatusPill>
          {data.dropText ? (
            <StatusPill tone="success" dot={false} title="Fiyat düştü">
              <ArrowDownRight aria-hidden="true" className="mr-0.5 h-3 w-3" />
              {data.dropText}
            </StatusPill>
          ) : null}
          {data.relist ? <StatusPill tone="warning" dot={false}>Tekrar ilan</StatusPill> : null}
          {data.doNotCall ? <StatusPill tone="danger">Aranmasın</StatusPill> : null}
          {data.isSample ? <StatusPill tone="neutral" dot={false}>Örnek</StatusPill> : null}
        </div>
      </div>

      <dl className="mt-3 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-4">
        <div><dt className="text-text-muted">Fiyat</dt><dd className="numeric font-semibold text-ink-950">{data.priceText}</dd></div>
        <div><dt className="text-text-muted">İlan yaşı</dt><dd className="font-medium text-ink-950">{data.ageText}</dd></div>
        <div><dt className="text-text-muted">Son temas</dt><dd className="font-medium text-ink-950">{data.lastContactText}</dd></div>
        <div>
          <dt className="text-text-muted">Sonraki arama</dt>
          <dd className={`font-medium ${data.overdue ? "text-danger-500" : "text-ink-950"}`}>{data.nextText}</dd>
        </div>
      </dl>
      <p className="mt-2 text-xs text-text-muted">
        {data.assigneeName ? `Danışman: ${data.assigneeName}` : "Sahipsiz (ilk dokunan sahiplenir)"}
        {data.ownerName ? ` · ${data.ownerName}` : ""}
        {data.phoneDisplay ? ` · ${data.phoneDisplay}` : data.piiPurged ? " · Kişisel veri saklama süresi doldu" : ""}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {canEdit && !locked && !lostLike && data.phoneTel ? (
          <a href={`tel:${data.phoneTel}`} onClick={() => setPanel("call")} className={buttonClass({ variant: "primary", size: SMALL })}>
            <Phone aria-hidden="true" className="h-3.5 w-3.5" /> Ara
          </a>
        ) : null}
        {canEdit && !locked && !lostLike ? (
          <>
            <Button size={SMALL} variant="outline" icon={Phone} onClick={() => toggle("call")} aria-expanded={panel === "call"}>Sonuç kaydet</Button>
            <Button size={SMALL} variant="outline" icon={NotebookPen} onClick={() => toggle("note")} aria-expanded={panel === "note"}>Not</Button>
            <Button size={SMALL} variant="outline" icon={ListPlus} onClick={() => toggle("task")} aria-expanded={panel === "task"}>Görev</Button>
            {data.hasPhone ? (
              <Button
                size={SMALL}
                variant="outline"
                icon={CalendarPlus}
                loading={pending}
                onClick={() => run(() => startFsboAppointment({ id: data.id }), "Satıcı müşteri kaydı hazır; randevu formu açılıyor.", (r) => r.href && router.push(r.href))}
              >
                Randevu
              </Button>
            ) : null}
            <Button size={SMALL} variant="outline" icon={UserCheck} onClick={() => toggle("yetki")} aria-expanded={panel === "yetki"}>Yetki alındı</Button>
          </>
        ) : null}
        {canConvert && !closed && !lostLike && !data.doNotCall ? (
          <Link href={`/app/portfoyler/yeni?fsbo=${data.id}`} className={buttonClass({ variant: "navy", size: SMALL })}>
            <Home aria-hidden="true" className="h-3.5 w-3.5" /> Portföye dönüştür
          </Link>
        ) : null}
        {canEdit && lostLike && !data.doNotCall ? (
          <Button size={SMALL} variant="outline" icon={Repeat} loading={pending} onClick={() => run(() => changeFsboStatus({ id: data.id, to: "yeni" }), "Kayıt yeniden açıldı.")}>
            Yeniden dene
          </Button>
        ) : null}
        {canEdit && !closed && !lostLike ? (
          <Button size={SMALL} variant="ghost" icon={XCircle} onClick={() => toggle("lost")} aria-expanded={panel === "lost"}>Kayıp</Button>
        ) : null}
        {canEdit && !closed && !data.doNotCall && data.hasPhone ? (
          <ConfirmDialog
            trigger={<Button size={SMALL} variant="ghost" icon={PhoneOff} loading={pending}>Aranmasın</Button>}
            title="Aranmasın olarak işaretle"
            description="Bu numara ofisinizin tüm danışmanları için aranmasın olarak işaretlenecek. Numaranın kendisi saklanmaz; yalnız eşleşme için şifreli özeti tutulur. Geri almak yalnız yöneticinin yetkisindedir."
            confirmLabel="Aranmasın olarak işaretle"
            onConfirm={() => {
              run(() => markFsboDoNotCall({ id: data.id }), "Numara aranmasın olarak işaretlendi.");
            }}
          />
        ) : null}
        {canDelete && isManager && data.doNotCall ? (
          <Button size={SMALL} variant="ghost" loading={pending} onClick={() => run(() => removeFsboDoNotCall({ id: data.id }), "Aranmasın kaydı kaldırıldı.")}>
            Aranmasın kaydını kaldır
          </Button>
        ) : null}
        {isManager && canEdit && !closed ? (
          <Button size={SMALL} variant="ghost" onClick={() => toggle("assign")} aria-expanded={panel === "assign"}>Danışman ata</Button>
        ) : null}
        {data.url ? (
          <a href={data.url} target="_blank" rel="noopener noreferrer" className={buttonClass({ variant: "ghost", size: SMALL })}>
            <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" /> İlanı aç
          </a>
        ) : null}
      </div>

      {panel === "call" ? (
        <form
          className={PANEL_CLASS}
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            run(
              () => logFsboCall({ id: data.id, outcome, note: String(fd.get("note") ?? ""), nextDate: String(fd.get("nextDate") ?? "") }),
              "Arama sonucu kaydedildi.",
            );
          }}
        >
          <p className="mb-2 text-xs text-text-muted">{callNotice}</p>
          {data.attempts === 0 ? (
            <details className="mb-3 rounded-[var(--radius-control)] border border-line bg-surface p-2.5 text-xs" open>
              <summary className="cursor-pointer font-semibold text-ink-950">Arama script&apos;i (ilk arama)</summary>
              <div className="mt-2 space-y-2">
                {script.map((s) => (
                  <div key={s.title}>
                    <p className="font-semibold text-ink-950">{s.title}</p>
                    {s.lines.map((l) => <p key={l} className="text-text-muted">{l}</p>)}
                  </div>
                ))}
              </div>
            </details>
          ) : null}
          <fieldset className="mb-3">
            <legend className="mb-1 text-xs font-semibold text-text-muted">Arama sonucu</legend>
            <div className="flex flex-wrap gap-1.5">
              {FSBO_OUTCOMES.filter((o) => o !== "aranmasin" && o !== "yetki").map((o) => (
                <label key={o} className={`focus-within:ring-2 cursor-pointer rounded-full border px-3 py-1.5 text-xs font-semibold touch:min-h-11 touch:inline-flex touch:items-center ${outcome === o ? "border-brand-400 bg-brand-600/10 text-brand-700" : "border-line bg-surface text-text-muted"}`}>
                  <input type="radio" name="outcome" value={o} checked={outcome === o} onChange={() => setOutcome(o)} className="sr-only" />
                  {OUTCOME_LABELS[o]}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Not" htmlFor={`call-note-${data.id}`}>
              <FormTextarea id={`call-note-${data.id}`} name="note" rows={2} maxLength={1000} placeholder="Konuşulanlar, beklenti, fiyat…" />
            </FormField>
            {outcome === "sonra_ara" ? (
              <FormField label="Tekrar arama günü" htmlFor={`call-next-${data.id}`} hint="Boş bırakırsanız takip ritmi uygulanır.">
                <FormInput id={`call-next-${data.id}`} name="nextDate" type="date" defaultValue={dayDefault} />
              </FormField>
            ) : null}
          </div>
          <div className="mt-3 flex gap-2">
            <Button type="submit" size="sm" loading={pending}>Kaydet</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setPanel(null)}>Vazgeç</Button>
          </div>
        </form>
      ) : null}

      {panel === "note" ? (
        <form
          className={PANEL_CLASS}
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            run(() => addFsboNote({ id: data.id, note: String(fd.get("note") ?? "") }), "Not eklendi.");
          }}
        >
          <FormField label="Not" htmlFor={`note-${data.id}`}>
            <FormTextarea id={`note-${data.id}`} name="note" rows={3} maxLength={1000} required />
          </FormField>
          <div className="mt-3 flex gap-2">
            <Button type="submit" size="sm" loading={pending}>Notu ekle</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setPanel(null)}>Vazgeç</Button>
          </div>
        </form>
      ) : null}

      {panel === "task" ? (
        <form
          className={PANEL_CLASS}
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            run(() => createFsboTask({ id: data.id, title: String(fd.get("title") ?? ""), dueDate: String(fd.get("dueDate") ?? "") }), "Görev oluşturuldu.");
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Görev" htmlFor={`task-title-${data.id}`}>
              <FormInput id={`task-title-${data.id}`} name="title" maxLength={200} placeholder="Tekrar ara" />
            </FormField>
            <FormField label="Gün" htmlFor={`task-due-${data.id}`} required>
              <FormInput id={`task-due-${data.id}`} name="dueDate" type="date" required defaultValue={dayDefault} />
            </FormField>
          </div>
          <div className="mt-3 flex gap-2">
            <Button type="submit" size="sm" loading={pending}>Görev ekle</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setPanel(null)}>Vazgeç</Button>
          </div>
        </form>
      ) : null}

      {panel === "lost" ? (
        <form
          className={PANEL_CLASS}
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            run(() => changeFsboStatus({ id: data.id, to: "kayip", lostReason: String(fd.get("reason") ?? "") }), "Kayıt kayıp olarak kapatıldı.");
          }}
        >
          <FormField label="Kayıp nedeni" htmlFor={`lost-${data.id}`} required hint={'"Aslında emlakçı" seçerseniz bu numara ofis genelinde aranmasın olur.'}>
            <FormSelect id={`lost-${data.id}`} name="reason" required defaultValue="">
              <option value="" disabled>Neden seçin</option>
              {FSBO_LOST_REASONS.map((r) => <option key={r} value={r}>{LOST_REASON_LABELS[r]}</option>)}
            </FormSelect>
          </FormField>
          <div className="mt-3 flex gap-2">
            <Button type="submit" size="sm" variant="danger" loading={pending}>Kayıp olarak kapat</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setPanel(null)}>Vazgeç</Button>
          </div>
        </form>
      ) : null}

      {panel === "yetki" ? (
        <form
          className={PANEL_CLASS}
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            run(
              () => changeFsboStatus({ id: data.id, to: "yetki_alindi", authorizationDate: String(fd.get("date") ?? ""), authorizationMonths: Number(fd.get("months") ?? 3) }),
              "Yetki alındı olarak işaretlendi.",
            );
          }}
        >
          <p className="mb-2 text-xs text-text-muted">Yetki alındı = yazılı yetkilendirme sözleşmesi imzalandı ve malik EİDS&apos;te ofisi yetkilendirdi. Süre 3 ayı aşarsa uyarılır, engellenmez.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Sözleşme tarihi" htmlFor={`yetki-date-${data.id}`} required>
              <FormInput id={`yetki-date-${data.id}`} name="date" type="date" required />
            </FormField>
            <FormField label="Süre (ay)" htmlFor={`yetki-months-${data.id}`}>
              <FormInput id={`yetki-months-${data.id}`} name="months" type="number" min={1} max={36} defaultValue={3} />
            </FormField>
          </div>
          <div className="mt-3 flex gap-2">
            <Button type="submit" size="sm" loading={pending}>Kaydet</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setPanel(null)}>Vazgeç</Button>
          </div>
        </form>
      ) : null}

      {panel === "assign" ? (
        <div className={PANEL_CLASS}>
          <FormField label="Danışman" htmlFor={`assign-${data.id}`} inject={false}>
            <PersonSelect id={`assign-${data.id}`} people={people} value={assignee} onValueChange={setAssignee} emptyLabel="Danışman seçin" />
          </FormField>
          <div className="mt-3 flex gap-2">
            <Button size="sm" loading={pending} disabled={!assignee} onClick={() => run(() => assignFsboLead({ id: data.id, assignedTo: assignee }), "Danışman atandı.")}>Ata</Button>
            <Button size="sm" variant="ghost" onClick={() => setPanel(null)}>Vazgeç</Button>
          </div>
        </div>
      ) : null}
    </article>
  );
}
