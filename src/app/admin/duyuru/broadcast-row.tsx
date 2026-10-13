"use client";

import { Button } from "@/components/ui/button";
import { useState, useTransition } from "react";
import Link from "@/components/ui/smart-link";
import { useRouter } from "next/navigation";
import { ChevronDown, Pencil, Trash2 } from "lucide-react";
import { deleteBroadcast, updateBroadcast } from "@/app/actions/platform-notifications";
import { DeliveryActions } from "./delivery-actions";
import { InlineTabbedPanel } from "@/components/ui/inline-tabbed-panel";
import { FormField, FormInput, FormTextarea } from "@/components/ui/form-controls";
import { KIND_OPTIONS } from "./broadcast-options";

export type BroadcastRowData = {
  id: string;
  title: string;
  body: string | null;
  kind: string;
  audienceLabel: string;
  tenantId: string | null;
  tenantName: string | null;
  sentCount: number;
  createdLabel: string;
  /** AD8 kuyruk alanları (eski satırlarda varsayılan). */
  status: string;
  channels: string[];
  scheduledLabel: string | null;
  expiresLabel: string | null;
  queued: boolean;
  recipients: number;
  delivered: number;
  failed: number;
  reads: number;
  clicks: number;
  inAppSent: number;
  emailSent: number;
  open: number;
  hasHref: boolean;
  commercial: boolean;
};

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  scheduled: { label: "Zamanlandı", cls: "bg-cyan-400/15 text-cyan-600" },
  sending: { label: "Gönderiliyor", cls: "bg-brand-600/15 text-brand-600" },
  sent: { label: "Gönderildi", cls: "bg-mint-500/15 text-mint-600" },
  partial: { label: "Kısmen", cls: "bg-amber-400/15 text-amber-700" },
  cancelled: { label: "İptal", cls: "bg-canvas text-text-muted" },
  expired: { label: "Süresi doldu", cls: "bg-canvas text-text-muted" },
};
const CHANNEL_LABEL: Record<string, string> = { in_app: "Uygulama içi", email: "E-posta", push: "Push" };
// Okunma payı (read_count) zil okunması + e-posta tıklamasıdır; payda aynı iki kanalın teslimi (oran %100'ü geçmez).
const pct = (n: number, d: number) => (d > 0 ? `%${Math.min(100, Math.round((n / d) * 100))}` : "—");

/** Duyuru geçmişi satırı: gövdeyi aç/kapat, düzenle (satır içi panel), geri çek (satır içi onay). */
export function BroadcastRow({ row, canEdit, isSuperAdmin }: { row: BroadcastRowData; canEdit: boolean; isSuperAdmin: boolean }) {
  const router = useRouter();
  const kindOpt = KIND_OPTIONS.find((k) => k.value === row.kind);
  const [expanded, setExpanded] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [delError, setDelError] = useState<string | null>(null);

  function save(fd: FormData) {
    setError(null);
    fd.set("id", row.id);
    start(async () => {
      const r = await updateBroadcast(fd);
      if (r.error) {
        setError(r.error);
        return;
      }
      setEditOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="px-5 py-3 transition hover:bg-brand-600/[0.02]">
      <div className="grid gap-2 sm:grid-cols-[1.4fr_1fr_auto_auto] sm:items-center">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="focus-ring flex min-w-0 items-center gap-2 text-left"
        >
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${kindOpt?.cls ?? "bg-canvas text-text-muted"}`}>{kindOpt?.label ?? row.kind}</span>
          <span className="truncate text-sm font-semibold text-ink-950">{row.title}</span>
          <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-text-faint transition ${expanded ? "rotate-180" : ""}`} />
        </button>
        <p className="text-xs text-text-muted">
          {row.tenantId ? (
            <Link href={`/admin/tenants/${row.tenantId}`} className="font-semibold text-brand-600 transition hover:underline">
              {row.tenantName ?? "Belirli ofis"}
            </Link>
          ) : (
            row.audienceLabel
          )}
        </p>
        {row.queued ? (
          <Link href={`/admin/duyuru?duyuru=${row.id}`} className="numeric w-fit rounded-full bg-mint-500/10 px-2.5 py-1 text-xs font-bold text-mint-600 transition hover:bg-mint-500/20">
            {row.sentCount} ofis · {row.recipients} kişi
          </Link>
        ) : (
          <span className="numeric w-fit rounded-full bg-mint-500/10 px-2.5 py-1 text-xs font-bold text-mint-600">{row.sentCount} ofis</span>
        )}
        <p className="text-xs text-text-faint">{row.scheduledLabel && row.status === "scheduled" ? `Plan: ${row.scheduledLabel}` : row.createdLabel}</p>
      </div>

      {row.queued ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
          <span className={`rounded-full px-2 py-0.5 font-bold ${STATUS_BADGE[row.status]?.cls ?? "bg-canvas text-text-muted"}`}>{STATUS_BADGE[row.status]?.label ?? row.status}</span>
          {row.channels.map((c) => (
            <span key={c} className="rounded-full border border-line px-2 py-0.5 text-text-muted">{CHANNEL_LABEL[c] ?? c}</span>
          ))}
          {row.commercial ? <span className="rounded-full border border-amber-400/40 px-2 py-0.5 text-amber-700">Ticari (İYS)</span> : null}
          {row.expiresLabel ? <span className="text-text-faint">Bitiş: {row.expiresLabel}</span> : null}
          <Link href={`/admin/duyuru?duyuru=${row.id}&durum=sent`} className="numeric rounded-full bg-mint-500/10 px-2 py-0.5 font-semibold text-mint-600 hover:underline">
            {row.delivered} teslim
          </Link>
          {row.open > 0 ? (
            <Link href={`/admin/duyuru?duyuru=${row.id}&durum=pending`} className="numeric rounded-full bg-brand-600/10 px-2 py-0.5 font-semibold text-brand-600 hover:underline">
              {row.open} kuyrukta
            </Link>
          ) : null}
          <Link href={`/admin/duyuru?duyuru=${row.id}&durum=okundu`} className="numeric rounded-full bg-cyan-400/10 px-2 py-0.5 font-semibold text-cyan-600 hover:underline" title="Okunma: zilde okunan + e-postadan tıklanan / uygulama içi + e-posta teslimi">
            Okunma {pct(row.reads, row.inAppSent + row.emailSent)} ({row.reads})
          </Link>
          {row.hasHref ? (
            <Link href={`/admin/duyuru?duyuru=${row.id}&durum=tiklandi`} className="numeric rounded-full bg-cyan-400/10 px-2 py-0.5 font-semibold text-cyan-600 hover:underline" title="Tıklama: bağlantıya tıklayan / toplam teslim">
              Tıklama {pct(row.clicks, row.delivered)} ({row.clicks})
            </Link>
          ) : null}
          {row.failed > 0 ? (
            <Link href={`/admin/duyuru?duyuru=${row.id}&durum=failed`} className="numeric rounded-full bg-danger-500/10 px-2 py-0.5 font-semibold text-danger-600 hover:underline">
              {row.failed} başarısız
            </Link>
          ) : null}
        </div>
      ) : null}

      {expanded ? (
        <div className="mt-2 rounded-[var(--radius-control)] border border-line bg-canvas/60 p-3 text-sm">
          {row.body ? <p className="whitespace-pre-line text-text-muted">{row.body}</p> : <p className="text-text-faint">Mesaj gövdesi yok.</p>}
        </div>
      ) : null}

      {canEdit ? (
        <div className="mt-2 flex flex-wrap items-start gap-2">
          {row.queued ? <DeliveryActions id={row.id} status={row.status} failed={row.failed} /> : null}
          <InlineTabbedPanel
            open={editOpen}
            onOpenChange={(v) => {
              if (v) setError(null);
              setEditOpen(v);
            }}
            title="Duyuruyu düzenle"
            description="Değişiklik arşive ve ofislerin bildirim kutusundaki mesaja yansır."
            icon={<Pencil />}
            onSubmit={save}
            pending={pending}
            error={error}
            summary={false}
            trigger={({ onClick, ...aria }) => (
              <Button variant="outline" size="sm" type="button" onClick={onClick} {...aria}>
                <Pencil className="h-3.5 w-3.5 text-brand-600" /> Düzenle
              </Button>
            )}
            tabs={[{ id: "icerik", label: "İçerik", fields: ["title", "body", "kind"] }]}
            panels={{
              icerik: (
                <>
                  <FormField label="Başlık" htmlFor={`bc-title-${row.id}`} required className="sm:col-span-2">
                    <FormInput id={`bc-title-${row.id}`} name="title" required maxLength={120} defaultValue={row.title} />
                  </FormField>
                  <FormField label="Mesaj" htmlFor={`bc-body-${row.id}`} className="sm:col-span-2">
                    <FormTextarea id={`bc-body-${row.id}`} name="body" rows={4} maxLength={2000} defaultValue={row.body ?? ""} />
                  </FormField>
                  <fieldset className="sm:col-span-2">
                    <legend className="mb-2 text-sm font-medium text-ink-950">Tür</legend>
                    <div className="flex flex-wrap gap-2">
                      {KIND_OPTIONS.map((k) => (
                        <label key={k.value} className="cursor-pointer">
                          <input type="radio" name="kind" value={k.value} defaultChecked={k.value === row.kind} className="peer sr-only" />
                          <span className={`inline-flex items-center rounded-full px-3 py-1.5 text-xs font-semibold ring-2 ring-transparent transition peer-checked:ring-current peer-focus-visible:ring-brand-500 ${k.cls}`}>{k.label}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                </>
              ),
            }}
          />
          {isSuperAdmin ? (
            confirmDelete ? (
              <span className="inline-flex flex-wrap items-center gap-2 rounded-[var(--radius-control)] border border-danger-500/30 bg-danger-500/5 px-2.5 py-1.5 text-xs">
                <span className="font-semibold text-danger-600">Duyuru ofislerin bildirim kutusundan da silinsin mi?</span>
                <Button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const fd = new FormData();
                      fd.set("id", row.id);
                      const r = await deleteBroadcast(fd);
                      if (r.error) {
                        setDelError(r.error);
                        return;
                      }
                      router.refresh();
                    })
                  }
                  variant="danger"
                  size="sm"
                >
                  {pending ? "Siliniyor…" : "Evet, geri çek"}
                </Button>
                <Button type="button" disabled={pending} onClick={() => setConfirmDelete(false)} variant="ghost" size="sm">Vazgeç</Button>
                {delError ? <span role="alert" className="w-full font-semibold text-danger-600">{delError}</span> : null}
              </span>
            ) : (
              <Button variant="outline" size="sm" type="button" onClick={() => setConfirmDelete(true)} className="text-danger-600">
                <Trash2 className="h-3.5 w-3.5" /> Geri çek
              </Button>
            )
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
