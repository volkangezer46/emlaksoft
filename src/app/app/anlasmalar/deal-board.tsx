"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Loader2, Pencil, Sparkles, X } from "lucide-react";
import { updateDealStage, updateDeal, type DealStage } from "@/app/actions/deals";
import { useToast } from "@/components/app/toast-provider";
import { StatusTransitionBar } from "./status-transition";

export type BoardDeal = {
  id: string;
  stage: string;
  deal_type: string;
  deal_value: number | null;
  probability: number | null;
  assigned_to: string | null;
  updated_at: string;
  property_title: string | null;
  property_code: string | null;
  property_id: string | null;
  customer_name: string | null;
  customer_id: string | null;
};

type Member = { id: string; full_name: string };

const STAGES: { key: DealStage; label: string; tone: string; ring: string }[] = [
  { key: "new", label: "Yeni", tone: "text-cyan-600", ring: "border-cyan-400/30 bg-cyan-400/5" },
  { key: "qualified", label: "Nitelikli", tone: "text-brand-600", ring: "border-brand-400/30 bg-brand-600/5" },
  { key: "negotiation", label: "Müzakere", tone: "text-amber-600", ring: "border-amber-400/35 bg-amber-400/5" },
  { key: "won", label: "Kazanıldı", tone: "text-mint-600", ring: "border-mint-500/35 bg-mint-500/5" },
  { key: "lost", label: "Kaybedildi", tone: "text-danger-500", ring: "border-danger-500/25 bg-danger-500/5" },
];

function money(n: number | null) {
  if (n == null) return "—";
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(n) + " ₺";
}

export function DealBoard({
  deals,
  canEdit = false,
  members = [],
}: {
  deals: BoardDeal[];
  canEdit?: boolean;
  members?: Member[];
}) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<BoardDeal | null>(null);
  const [lossFor, setLossFor] = useState<BoardDeal | null>(null);
  const [lossReason, setLossReason] = useState("");

  const columns = useMemo(() => {
    const map = Object.fromEntries(STAGES.map((s) => [s.key, [] as BoardDeal[]])) as Record<DealStage, BoardDeal[]>;
    for (const d of deals) {
      const key = (STAGES.some((s) => s.key === d.stage) ? d.stage : "new") as DealStage;
      map[key].push(d);
    }
    return map;
  }, [deals]);

  function move(dealId: string, stage: DealStage, reason?: string) {
    setBusyId(dealId);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("deal_id", dealId);
      fd.set("stage", stage);
      if (stage === "lost") fd.set("loss_reason", reason?.trim() || "Neden belirtilmedi");
      const res = await updateDealStage(fd);
      setBusyId(null);
      if (res.error) push(res.error, "err");
      else {
        push(stage === "won" ? "Kazanıldı · komisyon kontrol edin" : "Aşama güncellendi", "ok");
        router.refresh();
      }
    });
  }

  function submitEdit(formData: FormData) {
    startTransition(async () => {
      const res = await updateDeal(formData);
      if (res.error) push(res.error, "err");
      else {
        push("Anlaşma güncellendi", "ok");
        setEditing(null);
        router.refresh();
      }
    });
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {STAGES.map((col, colIdx) => {
        const rows = columns[col.key];
        const sum = rows.reduce((s, d) => s + (Number(d.deal_value) || 0), 0);
        return (
          <section
            key={col.key}
            className={`min-w-[260px] flex-1 rounded-[18px] border ${col.ring} backdrop-blur`}
            style={{ animationDelay: `${colIdx * 60}ms` }}
          >
            <header className="flex items-center justify-between border-b border-line/60 px-3.5 py-3">
              <div>
                <p className={`text-[11px] font-extrabold uppercase tracking-[0.12em] ${col.tone}`}>{col.label}</p>
                <p className="mt-0.5 text-[11px] text-text-muted">{rows.length} · {money(sum)}</p>
              </div>
              <span className="grid h-7 w-7 place-items-center rounded-[8px] bg-surface text-xs font-bold text-ink-950 shadow-[var(--shadow-xs)]">
                {rows.length}
              </span>
            </header>
            <div className="space-y-2.5 p-2.5">
              {rows.length === 0 ? (
                <div className="rounded-[12px] border border-dashed border-line-strong px-3 py-8 text-center text-[11px] text-text-faint">
                  Boş sütun
                </div>
              ) : (
                rows.map((d) => {
                  const idx = STAGES.findIndex((s) => s.key === d.stage);
                  const next = idx >= 0 && idx < STAGES.length - 1 ? STAGES[idx + 1] : null;
                  const busy = busyId === d.id && pending;
                  return (
                    <article
                      key={d.id}
                      className="lift group rounded-[14px] border border-line bg-surface p-3 shadow-[var(--shadow-xs)] transition hover:border-brand-300"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-ink-950">
                            {d.property_title ?? d.property_code ?? "Anlaşma"}
                          </p>
                          <p className="mt-0.5 truncate text-[11px] text-text-muted">
                            {d.customer_name ?? "Müşteri atanmadı"} · {d.deal_type === "rent" ? "Kiralama" : "Satış"}
                          </p>
                        </div>
                        {busy ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-brand-600" /> : null}
                      </div>
                      <p className="mt-2 font-display text-base font-extrabold text-ink-950">{money(d.deal_value)}</p>
                      <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-canvas">
                        <div
                          className="bar-live rounded-full bg-[image:var(--grad-brand)]"
                          style={{ width: `${Math.min(100, Number(d.probability) || 20)}%` }}
                        />
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-1.5">
                        <StatusTransitionBar dealId={d.id} stage={d.stage} />
                        {canEdit ? (
                          <button
                            type="button"
                            onClick={() => setEditing(d)}
                            className="inline-flex items-center gap-1 rounded-[7px] border border-line px-2 py-1 text-[10px] font-semibold text-text-muted hover:border-brand-300 hover:text-brand-600"
                          >
                            <Pencil className="h-3 w-3" /> Düzenle
                          </button>
                        ) : null}
                        {d.property_id ? (
                          <Link
                            href={`/app/portfoyler/${d.property_id}`}
                            className="rounded-[7px] border border-line px-2 py-1 text-[10px] font-semibold text-text-muted hover:border-brand-300 hover:text-brand-600"
                          >
                            Portföy
                          </Link>
                        ) : null}
                        {d.customer_id ? (
                          <Link
                            href={`/app/musteriler/${d.customer_id}`}
                            className="rounded-[7px] border border-line px-2 py-1 text-[10px] font-semibold text-text-muted hover:border-brand-300 hover:text-brand-600"
                          >
                            Müşteri
                          </Link>
                        ) : null}
                        {next && col.key !== "won" && col.key !== "lost" ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => move(d.id, next.key)}
                            className="ml-auto inline-flex items-center gap-1 rounded-[7px] bg-ink-950 px-2 py-1 text-[10px] font-bold text-white disabled:opacity-50"
                          >
                            {next.label} <ArrowRight className="h-3 w-3" />
                          </button>
                        ) : null}
                        {col.key === "negotiation" ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => move(d.id, "won")}
                            className="inline-flex items-center gap-1 rounded-[7px] bg-mint-500/15 px-2 py-1 text-[10px] font-bold text-mint-700 disabled:opacity-50"
                          >
                            <Sparkles className="h-3 w-3" /> Kazan
                          </button>
                        ) : null}
                        {col.key !== "lost" && col.key !== "won" ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => { setLossReason(""); setLossFor(d); }}
                            className="rounded-[7px] px-2 py-1 text-[10px] font-semibold text-danger-500 hover:bg-danger-500/10 disabled:opacity-50"
                          >
                            Kayıp
                          </button>
                        ) : null}
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          </section>
        );
      })}

      {editing ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-950/40 p-4 backdrop-blur-sm sm:items-center" onClick={() => setEditing(null)}>
          <div className="w-full max-w-md rounded-[20px] border border-line bg-surface shadow-[var(--shadow-lg)]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-line px-6 py-4">
              <h2 className="font-display text-lg font-bold text-ink-950">Anlaşmayı düzenle</h2>
              <button onClick={() => setEditing(null)} className="grid h-8 w-8 place-items-center rounded-[8px] text-text-muted hover:bg-canvas" aria-label="Kapat">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form action={submitEdit} className="space-y-4 p-6">
              <input type="hidden" name="deal_id" value={editing.id} />
              <p className="text-sm text-text-muted">{editing.property_title ?? editing.property_code ?? "Anlaşma"} · {editing.customer_name ?? "Müşteri atanmadı"}</p>
              <div>
                <label className="mb-1 block text-xs font-semibold text-text-muted">Anlaşma değeri (₺)</label>
                <input name="deal_value" defaultValue={editing.deal_value ?? ""} inputMode="numeric" className="w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-text-muted">Olasılık (%)</label>
                  <input name="probability" type="number" min={0} max={100} defaultValue={editing.probability ?? ""} className="w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-text-muted">Tür</label>
                  <select name="deal_type" defaultValue={editing.deal_type} className="w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400">
                    <option value="sale">Satış</option>
                    <option value="rent">Kiralama</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-text-muted">Sorumlu danışman</label>
                <select name="assigned_to" defaultValue={editing.assigned_to ?? ""} className="w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400">
                  <option value="">Değiştirme</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>{m.full_name}</option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setEditing(null)} className="rounded-[10px] border border-line px-4 py-2.5 text-sm font-semibold text-text-muted hover:bg-canvas">Vazgeç</button>
                <button type="submit" disabled={pending} className="rounded-[10px] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
                  {pending ? "Kaydediliyor…" : "Kaydet"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {lossFor ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-950/40 p-4 backdrop-blur-sm sm:items-center" onClick={() => setLossFor(null)}>
          <div className="w-full max-w-sm rounded-[20px] border border-line bg-surface shadow-[var(--shadow-lg)]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-line px-6 py-4">
              <h2 className="font-display text-lg font-bold text-ink-950">Kayıp nedeni</h2>
              <button onClick={() => setLossFor(null)} className="grid h-8 w-8 place-items-center rounded-[8px] text-text-muted hover:bg-canvas" aria-label="Kapat">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 p-6">
              <p className="text-sm text-text-muted">{lossFor.property_title ?? lossFor.property_code ?? "Anlaşma"} neden kaybedildi?</p>
              <div className="flex flex-wrap gap-1.5">
                {["Fiyat yüksek", "Rakip kapattı", "Müşteri vazgeçti", "İletişim koptu", "Finansman"].map((r) => (
                  <button key={r} type="button" onClick={() => setLossReason(r)} className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${lossReason === r ? "bg-danger-500 text-white" : "border border-line text-text-muted hover:border-danger-500/40"}`}>
                    {r}
                  </button>
                ))}
              </div>
              <textarea
                value={lossReason}
                onChange={(e) => setLossReason(e.target.value)}
                rows={2}
                placeholder="Neden…"
                className="w-full resize-none rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-danger-400"
              />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setLossFor(null)} className="rounded-[10px] border border-line px-4 py-2.5 text-sm font-semibold text-text-muted hover:bg-canvas">Vazgeç</button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => { const d = lossFor; setLossFor(null); if (d) move(d.id, "lost", lossReason); }}
                  className="rounded-[10px] bg-danger-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-danger-600 disabled:opacity-60"
                >
                  Kayıp olarak işaretle
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
