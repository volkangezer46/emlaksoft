"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Wrench } from "lucide-react";
import { createMaintenanceRequest, updateMaintenanceRequest, type RentalResult } from "@/app/actions/rentals";
import { useToast } from "@/components/app/toast-provider";
import { Badge } from "@/components/ui/badge";
import { Input, Textarea } from "@/components/ui/input";

type MaintRequest = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  cost: number | null;
  created_at: string;
};

const init: RentalResult = {};

const STATUS_META: Record<string, { label: string; variant: "warning" | "info" | "success" }> = {
  open: { label: "Açık", variant: "warning" },
  in_progress: { label: "Devam ediyor", variant: "info" },
  done: { label: "Tamamlandı", variant: "success" },
};

function money(n: number) {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(n);
}
function dateLabel(iso: string) {
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(new Date(iso));
}

/** Bakım talepleri — ekle, durum değiştir, maliyet gir. */
export function MaintenancePanel({
  rentalId,
  requests,
  canCreate,
  canEdit,
}: {
  rentalId: string;
  requests: MaintRequest[];
  canCreate: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const { push } = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState(createMaintenanceRequest, init);
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  // Maliyet taslakları — satır bazlı kontrollü input
  const [costDraft, setCostDraft] = useState<Record<string, string>>({});

  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
      push("Bakım talebi eklendi", "ok");
      router.refresh();
    }
  }, [state, push, router]);

  function setStatus(id: string, status: string) {
    setBusy(id);
    startTransition(async () => {
      const res = await updateMaintenanceRequest(id, rentalId, { status });
      setBusy(null);
      if (res.error) push(res.error, "err");
      else router.refresh();
    });
  }

  function saveCost(id: string) {
    const raw = (costDraft[id] ?? "").trim();
    const cost = raw === "" ? null : parseFloat(raw);
    setBusy(id);
    startTransition(async () => {
      const res = await updateMaintenanceRequest(id, rentalId, { cost });
      setBusy(null);
      if (res.error) push(res.error, "err");
      else {
        push("Maliyet kaydedildi", "ok");
        setCostDraft((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        router.refresh();
      }
    });
  }

  return (
    <section className="rounded-[20px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
      <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
        <Wrench className="h-4 w-4 text-amber-500" /> Bakım talepleri
        <span className="ml-auto text-xs font-normal text-text-faint">{requests.length} kayıt</span>
      </h2>

      {canCreate ? (
        <form ref={formRef} action={action} className="mt-3 space-y-2">
          <input type="hidden" name="rental_id" value={rentalId} />
          <Input name="title" required placeholder="Başlık (ör. Kombi arızası)" aria-label="Bakım talebi başlığı" />
          <Textarea name="description" rows={2} placeholder="Açıklama (opsiyonel)" aria-label="Bakım talebi açıklaması" className="min-h-16" />
          <div className="flex items-center justify-between gap-2">
            {state.error ? <p className="text-xs font-medium text-danger-600" role="alert">{state.error}</p> : <span />}
            <button
              type="submit"
              disabled={pending}
              className="focus-ring press inline-flex items-center gap-1.5 rounded-[9px] bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
            >
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Talep ekle
            </button>
          </div>
        </form>
      ) : null}

      {requests.length === 0 ? (
        <p className="mt-3 rounded-[12px] border border-dashed border-line-strong p-5 text-center text-sm text-text-muted">
          Açık bakım talebi yok.
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          {requests.map((r) => {
            const meta = STATUS_META[r.status] ?? STATUS_META.open;
            return (
              <div key={r.id} className="rounded-[12px] border border-line bg-canvas/50 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink-950">{r.title}</p>
                    {r.description ? <p className="mt-0.5 text-xs leading-relaxed text-text-muted">{r.description}</p> : null}
                    <p className="mt-1 text-[11px] text-text-faint">{dateLabel(r.created_at)}</p>
                  </div>
                  <Badge variant={meta.variant} size="sm" className="shrink-0">{meta.label}</Badge>
                </div>
                {canEdit ? (
                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    <select
                      value={r.status}
                      onChange={(e) => setStatus(r.id, e.target.value)}
                      disabled={busy === r.id}
                      aria-label={`${r.title} durumu`}
                      className="rounded-[8px] border border-line bg-surface px-2 py-1 text-[11px] font-semibold outline-none focus:border-brand-400 disabled:opacity-50"
                    >
                      <option value="open">Açık</option>
                      <option value="in_progress">Devam ediyor</option>
                      <option value="done">Tamamlandı</option>
                    </select>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={costDraft[r.id] ?? (r.cost != null ? String(r.cost) : "")}
                      onChange={(e) => setCostDraft((prev) => ({ ...prev, [r.id]: e.target.value }))}
                      placeholder="Maliyet (₺)"
                      aria-label={`${r.title} maliyeti`}
                      className="w-28 rounded-[8px] border border-line bg-surface px-2 py-1 text-[11px] outline-none focus:border-brand-400"
                    />
                    <button
                      type="button"
                      onClick={() => saveCost(r.id)}
                      disabled={busy === r.id || costDraft[r.id] === undefined}
                      className="focus-ring press inline-flex items-center gap-1 rounded-[8px] border border-hairline bg-surface px-2 py-1 text-[11px] font-semibold text-ink-950 transition hover:bg-canvas disabled:opacity-50"
                    >
                      {busy === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : null} Maliyeti kaydet
                    </button>
                    {r.cost != null && costDraft[r.id] === undefined ? (
                      <span className="numeric text-[11px] font-semibold text-text-muted">{money(Number(r.cost))}</span>
                    ) : null}
                  </div>
                ) : r.cost != null ? (
                  <p className="numeric mt-2 text-[11px] font-semibold text-text-muted">Maliyet: {money(Number(r.cost))}</p>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
