"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, Loader2, Plus, Trash2, Undo2 } from "lucide-react";
import { createDue, toggleDuePaid, deleteDue, type DueResult } from "@/app/actions/dues";

type Property = { id: string; property_code: string; title: string | null };
type Due = {
  id: string;
  title: string;
  amount: number;
  period: string;
  due_date: string | null;
  status: string;
  notes: string | null;
  property: { id: string; property_code: string; title: string | null } | { id: string; property_code: string; title: string | null }[] | null;
};

const init: DueResult = {};

function money(n: number) {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(n);
}
function monthLabel(iso: string) {
  return new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric" }).format(new Date(iso));
}
function propOf(p: Due["property"]) {
  return Array.isArray(p) ? p[0] : p;
}

export function DuesClient({ dues, properties, canCreate }: { dues: Due[]; properties: Property[]; canCreate: boolean }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState(createDue, init);
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
      router.refresh();
    }
  }, [state, router]);

  function toggle(id: string, toPaid: boolean) {
    setBusy(id);
    startTransition(async () => {
      await toggleDuePaid(id, toPaid);
      setBusy(null);
      router.refresh();
    });
  }
  function remove(id: string) {
    setBusy(id);
    startTransition(async () => {
      await deleteDue(id);
      setBusy(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {canCreate ? (
        <section className="rounded-[18px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-ink-950"><Plus className="h-4 w-4 text-brand-600" /> Yeni aidat kaydı</h2>
          <form ref={formRef} action={action} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <input name="title" required placeholder="Başlık (ör. Nisan aidatı)" className="rounded-[10px] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-400 sm:col-span-2 lg:col-span-1" />
            <input name="amount" type="number" min="0" step="0.01" required placeholder="Tutar (₺)" className="rounded-[10px] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-400" />
            <input name="period" type="date" defaultValue={new Date().toISOString().slice(0, 10)} className="rounded-[10px] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-400" title="İlgili ay" />
            <input name="due_date" type="date" className="rounded-[10px] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-400" title="Son ödeme tarihi" />
            <select name="property_id" defaultValue="" className="rounded-[10px] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-400 sm:col-span-2 lg:col-span-3">
              <option value="">Portföy (opsiyonel)</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>{p.title ?? p.property_code}</option>
              ))}
            </select>
            <button type="submit" disabled={pending} className="inline-flex items-center justify-center gap-1.5 rounded-[10px] bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60">
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Ekle
            </button>
          </form>
          {state.error ? <p className="mt-2 text-sm text-danger-500">{state.error}</p> : null}
        </section>
      ) : null}

      <section className="overflow-hidden rounded-[20px] border border-line bg-surface shadow-[var(--shadow-xs)]">
        {dues.length === 0 ? (
          <p className="py-16 text-center text-sm text-text-muted">Henüz aidat kaydı yok.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-line bg-canvas/80 text-text-muted">
                <tr>
                  <th className="px-5 py-3 font-semibold">Başlık</th>
                  <th className="px-4 py-3 font-semibold">Portföy</th>
                  <th className="px-4 py-3 font-semibold">Dönem</th>
                  <th className="px-4 py-3 font-semibold">Tutar</th>
                  <th className="px-4 py-3 font-semibold">Durum</th>
                  <th className="px-4 py-3"><span className="sr-only">İşlem</span></th>
                </tr>
              </thead>
              <tbody>
                {dues.map((d) => {
                  const prop = propOf(d.property);
                  const paid = d.status === "paid";
                  const overdue = !paid && d.due_date && new Date(d.due_date) < new Date();
                  return (
                    <tr key={d.id} className="border-b border-line last:border-0 hover:bg-canvas/40">
                      <td className="px-5 py-3 font-semibold text-ink-950">{d.title}</td>
                      <td className="px-4 py-3 text-text-muted">
                        {prop ? <Link href={`/app/portfoyler/${prop.id}`} className="hover:text-brand-600">{prop.title ?? prop.property_code}</Link> : "—"}
                      </td>
                      <td className="px-4 py-3 text-text-muted">{monthLabel(d.period)}</td>
                      <td className="px-4 py-3 font-bold text-ink-950">{money(Number(d.amount))}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold ${paid ? "bg-mint-500/12 text-mint-600" : overdue ? "bg-danger-500/12 text-danger-600" : "bg-amber-400/15 text-amber-600"}`}>
                          {paid ? "Ödendi" : overdue ? "Gecikti" : "Bekliyor"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1.5">
                          <button type="button" onClick={() => toggle(d.id, !paid)} disabled={busy === d.id}
                            className="inline-flex items-center gap-1 rounded-[8px] border border-line px-2 py-1 text-[11px] font-semibold text-ink-950 transition hover:bg-canvas disabled:opacity-50">
                            {busy === d.id ? <Loader2 className="h-3 w-3 animate-spin" /> : paid ? <Undo2 className="h-3 w-3" /> : <Check className="h-3 w-3 text-mint-600" />}
                            {paid ? "Geri al" : "Ödendi"}
                          </button>
                          <button type="button" onClick={() => remove(d.id)} disabled={busy === d.id} aria-label="Sil"
                            className="grid h-7 w-7 place-items-center rounded-[8px] text-text-faint transition hover:bg-danger-500/10 hover:text-danger-500 disabled:opacity-50">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
