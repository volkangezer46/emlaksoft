"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, Coins, Loader2, Plus, Trash2, Undo2 } from "lucide-react";
import { createDue, toggleDuePaid, deleteDue, type DueResult } from "@/app/actions/dues";
import { EmptyState } from "@/components/app/empty-state";
import { Badge } from "@/components/ui/badge";
import { Table, TableFrame, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Combobox } from "@/components/ui/combobox";
import { searchProperties } from "@/app/actions/lookup";

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
            {/* Bu iki tarih alanının TEK etiketi `title` idi. Native `title`
                ekran okuyucularda güvenilir okunmaz ve görsel olarak da hiçbir
                şey göstermez: kullanıcı iki boş tarih kutusu görüyordu.
                Gerçek <label> ile değiştirildi. */}
            <label className="block text-[11px] font-semibold text-text-muted">
              İlgili ay
              <input name="period" type="date" defaultValue={new Date().toISOString().slice(0, 10)} className="mt-1 w-full rounded-[10px] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-400" />
            </label>
            <label className="block text-[11px] font-semibold text-text-muted">
              Son ödeme tarihi
              <input name="due_date" type="date" className="mt-1 w-full rounded-[10px] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-400" />
            </label>
            <div className="sm:col-span-2 lg:col-span-3">
              <Combobox
                name="property_id"
                aria-label="Portföy"
                placeholder="Portföy (opsiyonel)"
                searchPlaceholder="Kod ya da başlık ara…"
                emptyText="Eşleşen portföy yok"
                onSearch={searchProperties}
                options={properties.map((p) => ({
                  value: p.id,
                  label: p.title ?? p.property_code,
                  hint: p.title ? p.property_code : undefined,
                }))}
              />
            </div>
            <button type="submit" disabled={pending} className="inline-flex items-center justify-center gap-1.5 rounded-[10px] bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60">
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Ekle
            </button>
          </form>
          {state.error ? <p className="mt-2 text-sm text-danger-500">{state.error}</p> : null}
        </section>
      ) : null}

      {dues.length === 0 ? (
        <EmptyState
          icon={Coins}
          title="Henüz aidat kaydı yok"
          description="Portföy bazlı aidat ve ortak gider kayıtlarınız burada listelenecek. Yukarıdan ilk kaydı ekleyin."
          tone="amber"
        />
      ) : (
        <TableFrame minWidth={720}>
          <Table>
            <THead>
              <TR>
                <TH>Başlık</TH>
                <TH>Portföy</TH>
                <TH>Dönem</TH>
                <TH align="right">Tutar</TH>
                <TH>Durum</TH>
                <TH align="right"><span className="sr-only">İşlem</span></TH>
              </TR>
            </THead>
            <TBody>
                {dues.map((d) => {
                  const prop = propOf(d.property);
                  const paid = d.status === "paid";
                  const overdue = !paid && d.due_date && new Date(d.due_date) < new Date();
                  return (
                    /* Satırın tamamı ilgili portföye tıklanabilir — diğer liste
                       sayfalarıyla tutarlı. Aidatın kendi detay sayfası yok,
                       bağlamsal olarak doğru hedef portföy. */
                    <TR key={d.id} interactive={Boolean(prop)}>
                      <TD className="font-semibold text-ink-950">
                        {prop ? (
                          <Link
                            href={`/app/portfoyler/${prop.id}`}
                            className="absolute inset-0"
                            aria-label={`${d.title} — ${prop.title ?? prop.property_code} portföyünü aç`}
                          />
                        ) : null}
                        {d.title}
                      </TD>
                      <TD className="text-text-muted">
                        {prop ? (prop.title ?? prop.property_code) : "—"}
                      </TD>
                      <TD className="text-text-muted">{monthLabel(d.period)}</TD>
                      <TD align="right" className="font-bold text-ink-950">{money(Number(d.amount))}</TD>
                      <TD>
                        <Badge variant={paid ? "success" : overdue ? "danger" : "warning"} size="sm">
                          {paid ? "Ödendi" : overdue ? "Gecikti" : "Bekliyor"}
                        </Badge>
                      </TD>
                      <TD align="right">
                        {/* relative + z-10: satır linkinin üstünde kalsın */}
                        <div className="relative z-10 flex items-center justify-end gap-1.5">
                          <button type="button" onClick={() => toggle(d.id, !paid)} disabled={busy === d.id}
                            className="focus-ring press inline-flex items-center gap-1 rounded-[8px] border border-hairline bg-surface px-2 py-1 text-[11px] font-semibold text-ink-950 shadow-[var(--elev-1)] transition hover:bg-canvas disabled:opacity-50">
                            {busy === d.id ? <Loader2 className="h-3 w-3 animate-spin" /> : paid ? <Undo2 className="h-3 w-3" /> : <Check className="h-3 w-3 text-mint-600" />}
                            {paid ? "Geri al" : "Ödendi"}
                          </button>
                          <button type="button" onClick={() => remove(d.id)} disabled={busy === d.id} aria-label={`${d.title} aidatını sil`}
                            className="focus-ring press grid h-7 w-7 place-items-center rounded-[8px] text-text-faint transition hover:bg-danger-500/10 hover:text-danger-600 disabled:opacity-50">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </TD>
                    </TR>
                  );
                })}
            </TBody>
          </Table>
        </TableFrame>
      )}
    </div>
  );
}
