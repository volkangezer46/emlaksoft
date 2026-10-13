"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CalendarClock, GitCompareArrows, Loader2, Rocket, RotateCcw, X } from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  cancelScheduled,
  previewDraftDiff,
  previewVersionDiff,
  publishDraftNow,
  restoreVersion,
  schedulePublish,
  type DiffPreview,
} from "@/app/actions/publishing";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { FormField, FormInput } from "@/components/ui/form-controls";

/**
 * YAYIN MASASI istemci parçaları: fark çekmecesi, "Taslağı zamanla" diyaloğu, "Şimdi yayınla", takvimde iptal, akışta "Fark" ve
 * "Bu sürüme dön" (dönmeden önce fark onayı). Veri yalnız server action'lardan gelir; sunucu modülü içe aktarılmaz.
 */

const KIND: Record<string, { text: string; cls: string }> = {
  changed: { text: "Değişti", cls: "bg-brand-600/10 text-brand-700" },
  added: { text: "Eklendi", cls: "bg-mint-500/15 text-mint-700" },
  removed: { text: "Silindi", cls: "bg-danger-500/10 text-danger-700" },
};

function DiffRows({ diff }: { diff: DiffPreview | null }) {
  if (!diff) {
    return (
      <p className="flex items-center gap-2 text-sm text-text-muted">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Fark hazırlanıyor…
      </p>
    );
  }
  if (diff.error) return <p className="text-sm text-danger-700">{diff.error}</p>;
  if (!diff.rows?.length) return <p className="text-sm text-text-muted">Fark yok: iki sürüm aynı.</p>;
  return (
    <div className="space-y-2">
      <p className="text-xs text-text-faint">{diff.total} alan farklı</p>
      <ul className="divide-y divide-line rounded-[var(--radius-card)] border border-line">
        {diff.rows.map((r) => (
          <li key={`${r.kind}:${r.path}`} className="space-y-1.5 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${KIND[r.kind]?.cls ?? ""}`}>{KIND[r.kind]?.text ?? r.kind}</span>
              <code className="break-all text-xs font-semibold text-ink-950">{r.path}</code>
            </div>
            <div className="grid gap-1.5 text-xs sm:grid-cols-2">
              <p className="break-words rounded-[var(--radius-control)] bg-danger-500/5 p-2 text-text-muted">
                <span className="mb-0.5 block text-xs font-bold uppercase tracking-wide text-text-faint">Eski</span>
                {r.before}
              </p>
              <p className="break-words rounded-[var(--radius-control)] bg-mint-500/10 p-2 text-ink-950">
                <span className="mb-0.5 block text-xs font-bold uppercase tracking-wide text-text-faint">Yeni</span>
                {r.after}
              </p>
            </div>
          </li>
        ))}
      </ul>
      {diff.more ? <p className="text-xs font-semibold text-text-muted">{diff.more}</p> : null}
    </div>
  );
}

/** Sağdan açılan fark çekmecesi (Radix: odak tuzağı, Esc, odak dönüşü). */
function DiffDrawer({
  open,
  onOpenChange,
  title,
  diff,
  footer,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  diff: DiffPreview | null;
  footer?: React.ReactNode;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="dialog-overlay fixed inset-0 z-50 bg-ink-950/55 backdrop-blur-sm" />
        <DialogPrimitive.Content className="fixed inset-y-0 right-0 z-50 flex h-dvh w-[min(96vw,620px)] flex-col border-l border-line bg-surface shadow-[var(--shadow-lg)] outline-none">
          <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div>
              <DialogPrimitive.Title className="font-display text-base font-extrabold text-ink-950">{diff?.title ?? title}</DialogPrimitive.Title>
              <DialogPrimitive.Description className="text-xs text-text-muted">Alan bazında eski ve yeni değer.</DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close className="focus-ring grid h-11 w-11 place-items-center rounded-[var(--radius-control)] text-text-muted hover:bg-surface-hover" aria-label="Kapat">
              <X className="h-5 w-5" />
            </DialogPrimitive.Close>
          </div>
          <div className="flex-1 overflow-y-auto overscroll-contain p-5">
            <DiffRows diff={diff} />
          </div>
          {footer ? <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-4">{footer}</div> : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** "Taslakta N değişiklik" bağlantısı: fark çekmecesini açar. */
export function DraftDiffLink({ surface, count }: { surface: string; count: number }) {
  const [open, setOpen] = useState(false);
  const [diff, setDiff] = useState<DiffPreview | null>(null);
  const openDrawer = () => {
    setDiff(null);
    setOpen(true);
    void previewDraftDiff(surface).then(setDiff, () => setDiff({ error: "Fark alınamadı." }));
  };
  return (
    <>
      <Button variant="ghost" size="sm" icon={GitCompareArrows} onClick={openDrawer} className="-ml-3 font-bold text-brand-700">
        Taslakta {count} değişiklik
      </Button>
      <DiffDrawer open={open} onOpenChange={setOpen} title="Taslak farkı" diff={diff} />
    </>
  );
}

/** "Taslağı zamanla": başlangıç, isteğe bağlı bitiş ve açıklama (TR saati). */
export function ScheduleButton({ surface, surfaceLabel, minLocal, disabled }: { surface: string; surfaceLabel: string; minLocal: string; disabled?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const uid = useId();

  const submit = (confirm: boolean) => {
    setError(null);
    startTransition(async () => {
      const res = await schedulePublish(surface, start, end || null, label, confirm);
      if (res.needsConfirm) {
        setWarning(res.warning ?? "Çakışan zamanlama var.");
        return;
      }
      if (res.error) {
        setError(res.error);
        return;
      }
      setOpen(false);
      setStart("");
      setEnd("");
      setLabel("");
      setWarning(null);
      router.refresh();
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) {
          setError(null);
          setWarning(null);
        }
      }}
    >
      <Button variant="outline" size="sm" icon={CalendarClock} disabled={disabled} onClick={() => setOpen(true)} title={disabled ? "Zamanlanacak taslak yok ya da yetkiniz yok" : undefined}>
        Taslağı zamanla
      </Button>
      <DialogContent size="md">
        <DialogHeader icon={<CalendarClock />} title="Taslağı zamanla" description={`${surfaceLabel}: kayıtlı taslağın şu anki hâli zamanında yayınlanır.`} />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(Boolean(warning));
          }}
        >
          <DialogBody className="space-y-4">
            <FormField label="Başlangıç (Türkiye saati)" htmlFor={`${uid}-start`} required>
              <FormInput id={`${uid}-start`} type="datetime-local" required min={minLocal} value={start} onChange={(e) => { setStart(e.target.value); setWarning(null); }} />
            </FormField>
            <FormField label="Bitiş (isteğe bağlı)" htmlFor={`${uid}-end`} hint="Bitişte önceki sürüme dönülür. Arada elle yayın yapılırsa dönülmez ve size bildirim düşer.">
              <FormInput id={`${uid}-end`} type="datetime-local" min={start || minLocal} value={end} onChange={(e) => { setEnd(e.target.value); setWarning(null); }} />
            </FormField>
            <FormField label="Açıklama" htmlFor={`${uid}-label`}>
              <FormInput id={`${uid}-label`} value={label} maxLength={80} placeholder="ör. Bayram kampanyası duyurusu" onChange={(e) => setLabel(e.target.value)} />
            </FormField>
            {warning ? (
              <p role="status" className="flex gap-2 rounded-[var(--radius-control)] bg-amber-100 p-3 text-sm text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                {warning}
              </p>
            ) : null}
            {error ? <p role="alert" className="text-sm font-semibold text-danger-700">{error}</p> : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Vazgeç</Button>
            <Button type="submit" loading={pending} icon={CalendarClock}>
              {warning ? "Yine de zamanla" : "Zamanla"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** "Şimdi yayınla": bekleyen taslağı hemen canlıya alır (önce onay); yayın sonrası canlı doğrulaması rozette görünür. */
export function PublishNowButton({ surface, surfaceLabel }: { surface: string; surfaceLabel: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <ConfirmDialog
        trigger={<Button variant="outline" size="sm" icon={Rocket}>Şimdi yayınla</Button>}
        title={`${surfaceLabel} yayınlansın mı?`}
        description="Kayıtlı taslak hemen canlıya alınır ve geçmişe yazılır; istediğiniz an önceki sürüme dönebilirsiniz."
        confirmLabel="Yayınla"
        tone="default"
        onConfirm={async () => {
          const res = await publishDraftNow(surface);
          if (res.error) setError(res.error);
          else router.refresh();
        }}
      />
      {error ? <span role="alert" className="text-xs text-danger-700">{error}</span> : null}
    </span>
  );
}

/** Takvim satırında iptal (bekleyen: hiç yayınlanmaz; yayındaki: bitişte geri dönülmez). */
export function CancelScheduleButton({ id, live }: { id: string; live: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <ConfirmDialog
        trigger={<Button variant="ghost" size="sm">İptal</Button>}
        title={live ? "Bitişte geri dönüş iptal edilsin mi?" : "Zamanlama iptal edilsin mi?"}
        description={live ? "Canlı sürüm olduğu gibi kalır; bitiş zamanında önceki sürüme dönülmez." : "Bu taslak zamanında yayınlanmaz. Taslağın kendisi editörde durur."}
        confirmLabel="İptal et"
        onConfirm={async () => {
          const res = await cancelScheduled(id);
          if (res.error) setError(res.error);
          else router.refresh();
        }}
      />
      {error ? <span role="alert" className="text-xs text-danger-700">{error}</span> : null}
    </span>
  );
}

/** Akış satırı: "Fark" (canlı → bu sürüm) ve "Bu sürüme dön" (önce fark, sonra onay). */
export function HistoryRowActions({ surface, historyId, canWrite, isLive }: { surface: string; historyId: string; canWrite: boolean; isLive: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [restoreMode, setRestoreMode] = useState(false);
  const [diff, setDiff] = useState<DiffPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const show = (restore: boolean) => {
    setDiff(null);
    setError(null);
    setRestoreMode(restore);
    setOpen(true);
    void previewVersionDiff(surface, historyId).then(setDiff, () => setDiff({ error: "Fark alınamadı." }));
  };

  const doRestore = () =>
    startTransition(async () => {
      const res = await restoreVersion(surface, historyId);
      if (res.error) {
        setError(res.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });

  return (
    <span className="flex flex-wrap items-center justify-end gap-1">
      <Button variant="ghost" size="sm" icon={GitCompareArrows} onClick={() => show(false)}>
        Fark
      </Button>
      {canWrite && !isLive ? (
        <Button variant="ghost" size="sm" icon={RotateCcw} onClick={() => show(true)}>
          Bu sürüme dön
        </Button>
      ) : null}
      <DiffDrawer
        open={open}
        onOpenChange={setOpen}
        title="Sürüm farkı"
        diff={diff}
        footer={
          restoreMode ? (
            <>
              {error ? <span role="alert" className="mr-auto self-center text-sm text-danger-700">{error}</span> : null}
              <Button variant="ghost" onClick={() => setOpen(false)}>Vazgeç</Button>
              <Button icon={RotateCcw} loading={pending} disabled={!diff || Boolean(diff.error)} onClick={doRestore}>
                Farkı gördüm, bu sürüme dön
              </Button>
            </>
          ) : undefined
        }
      />
    </span>
  );
}
