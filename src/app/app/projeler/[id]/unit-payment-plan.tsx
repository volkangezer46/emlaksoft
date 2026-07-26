"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, CheckCircle2, Plus, Trash2, Undo2, Wallet, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input, FormField } from "@/components/ui/input";
import {
  createPaymentPlan,
  deletePaymentPlan,
  listUnitPayments,
  togglePaymentPaid,
  type PaymentStatus,
  type UnitPaymentRow,
} from "@/app/actions/projects";

const KIND_LABELS: Record<string, string> = {
  pesinat: "Peşinat",
  taksit: "Taksit",
  ara_odeme: "Ara ödeme",
};

const STATUS_META: Record<PaymentStatus, { label: string; variant: BadgeVariant }> = {
  pending: { label: "Bekliyor", variant: "warning" },
  paid: { label: "Ödendi", variant: "success" },
  overdue: { label: "Gecikti", variant: "danger" },
};

function money(n: number) {
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(n) + " ₺";
}

function fmtDate(iso: string) {
  return new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("tr-TR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/**
 * Daire ödeme planı — units-board dialog'unda kaporalı/satılan daire için:
 *  - Plan yoksa: peşinat % + taksit sayısı + başlangıç tarihi + opsiyonel ara
 *    ödemeler (ay + tutar, en fazla 4) formu (canlı önizleme)
 *  - Plan varsa: satır listesi (vade/tutar/durum + Ödendi toggle), özet + ilerleme
 *    barı, geciken satırlar kırmızı; hiç ödeme alınmadıysa plan silinebilir.
 */
export function UnitPaymentPlan({
  unitId,
  listPrice,
  canEdit,
}: {
  unitId: string;
  listPrice: number | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [payments, setPayments] = useState<UnitPaymentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Render saflığı: zaman okuması mount anında bir kez (bkz. units-board).
  const [today] = useState(() => new Date().toISOString().slice(0, 10));

  const [pesinatPct, setPesinatPct] = useState("25");
  const [taksitSayisi, setTaksitSayisi] = useState("12");
  const [baslangic, setBaslangic] = useState(() => new Date().toISOString().slice(0, 10));
  // Opsiyonel ara ödemeler — ay: başlangıçtan ay ofseti, tutar TL (en fazla 4 satır)
  const [araRows, setAraRows] = useState<{ ay: string; tutar: string }[]>([]);
  const MAX_ARA = 4;

  const setAraRow = (i: number, patch: Partial<{ ay: string; tutar: string }>) =>
    setAraRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const reload = useCallback(() => {
    listUnitPayments(unitId).then(setPayments);
  }, [unitId]);

  useEffect(() => {
    reload();
  }, [reload]);

  // ---- Önizleme (createPaymentPlan ile aynı kuruş mantığı) ----
  const pct = parseFloat(pesinatPct);
  const n = parseInt(taksitSayisi, 10);
  const price = listPrice ?? 0;
  const baseOk = price > 0 && Number.isFinite(pct) && pct >= 0 && pct < 100 && Number.isFinite(n) && n >= 1 && n <= 120;
  const pesinatTutar = baseOk ? Math.round((price * pct) / 100) : 0;
  // Geçerli ara ödeme satırları (ay >= 1, tutar > 0) — action'daki filtreyle aynı
  const araParsed = araRows
    .map((r) => ({ ay: parseInt(r.ay, 10), tutar: parseFloat(r.tutar) }))
    .filter((a) => Number.isFinite(a.ay) && a.ay >= 1 && Number.isFinite(a.tutar) && a.tutar > 0);
  const araToplam = araParsed.reduce((s, a) => s + a.tutar, 0);
  const kalan = price - pesinatTutar - araToplam;
  const previewOk = baseOk && kalan > 0;
  const taksitTutar = previewOk ? kalan / n : 0;

  const rows = payments ?? [];
  const total = rows.reduce((s, p) => s + Number(p.amount), 0);
  const paidSum = rows.filter((p) => p.status === "paid").reduce((s, p) => s + Number(p.amount), 0);
  const paidCount = rows.filter((p) => p.status === "paid").length;
  const progress = total > 0 ? Math.round((paidSum / total) * 100) : 0;
  const isLate = (p: UnitPaymentRow) => p.status === "overdue" || (p.status === "pending" && p.due_date < today);

  const create = () => {
    startTransition(async () => {
      const res = await createPaymentPlan(unitId, {
        pesinatPct: pct,
        taksitSayisi: n,
        baslangicAyi: baslangic,
        araOdemeler: araParsed.map((a) => ({ ay: a.ay, tutar: a.tutar })),
      });
      if (res.error) {
        setError(res.error);
        return;
      }
      setError(null);
      reload();
      router.refresh();
    });
  };

  const toggle = (paymentId: string) => {
    startTransition(async () => {
      const res = await togglePaymentPaid(paymentId);
      if (res.error) {
        setError(res.error);
        return;
      }
      setError(null);
      reload();
      router.refresh();
    });
  };

  return (
    <div className="rounded-[14px] border border-line bg-canvas p-4">
      <h4 className="flex items-center gap-2 text-xs font-bold text-ink-950">
        <Wallet className="h-4 w-4 text-brand-600" /> Ödeme planı
      </h4>

      {payments === null ? (
        <p className="mt-3 text-sm text-text-muted">Plan yükleniyor…</p>
      ) : rows.length === 0 ? (
        canEdit ? (
          <div className="mt-3 space-y-3">
            {price > 0 ? (
              <>
                <div className="grid gap-3 sm:grid-cols-3">
                  <FormField label="Peşinat (%)" htmlFor="pp-pct">
                    <Input
                      id="pp-pct"
                      type="number"
                      min={0}
                      max={99}
                      value={pesinatPct}
                      onChange={(e) => setPesinatPct(e.target.value)}
                    />
                  </FormField>
                  <FormField label="Taksit sayısı" htmlFor="pp-count">
                    <Input
                      id="pp-count"
                      type="number"
                      min={1}
                      max={120}
                      value={taksitSayisi}
                      onChange={(e) => setTaksitSayisi(e.target.value)}
                    />
                  </FormField>
                  <FormField label="Başlangıç" htmlFor="pp-start" hint="Peşinat vadesi; taksitler aynı gün aylık">
                    <Input
                      id="pp-start"
                      type="date"
                      value={baslangic}
                      onChange={(e) => setBaslangic(e.target.value)}
                    />
                  </FormField>
                </div>

                {/* Opsiyonel ara ödemeler — ay ofseti + tutar, en fazla 4 satır */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-text-muted">
                      Ara ödemeler <span className="font-normal text-text-faint">(opsiyonel)</span>
                    </p>
                    {araRows.length < MAX_ARA ? (
                      <Button size="sm" variant="ghost" onClick={() => setAraRows((r) => [...r, { ay: "", tutar: "" }])}>
                        <Plus className="h-3.5 w-3.5" /> Ara ödeme ekle
                      </Button>
                    ) : null}
                  </div>
                  {araRows.map((row, i) => (
                    <div key={i} className="flex items-end gap-2">
                      <FormField label="Ay" htmlFor={`pp-ara-ay-${i}`} hint="Başlangıçtan ay ofseti">
                        <Input
                          id={`pp-ara-ay-${i}`}
                          type="number"
                          min={1}
                          max={120}
                          placeholder="ör. 6"
                          value={row.ay}
                          onChange={(e) => setAraRow(i, { ay: e.target.value })}
                        />
                      </FormField>
                      <FormField label="Tutar (₺)" htmlFor={`pp-ara-tutar-${i}`}>
                        <Input
                          id={`pp-ara-tutar-${i}`}
                          type="number"
                          min={0}
                          placeholder="ör. 500.000"
                          value={row.tutar}
                          onChange={(e) => setAraRow(i, { tutar: e.target.value })}
                        />
                      </FormField>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setAraRows((rows) => rows.filter((_, idx) => idx !== i))}
                        title="Satırı kaldır"
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>

                {previewOk ? (
                  <div className="rounded-[10px] border border-brand-600/20 bg-brand-600/5 px-3 py-2 text-xs text-text-muted">
                    Önizleme: peşinat <strong className="numeric text-ink-950">{money(pesinatTutar)}</strong>
                    {araToplam > 0 ? (
                      <>
                        {" + "}
                        <strong className="numeric text-ink-950">{araParsed.length}</strong> ara ödeme{" "}
                        <strong className="numeric text-ink-950">{money(Math.round(araToplam))}</strong>
                      </>
                    ) : null}
                    {" + "}
                    <strong className="numeric text-ink-950">{n}</strong> × taksit{" "}
                    <strong className="numeric text-ink-950">{money(Math.round(taksitTutar))}</strong>
                    {" = toplam "}
                    <strong className="numeric text-ink-950">{money(price)}</strong>
                  </div>
                ) : baseOk && kalan <= 0 ? (
                  <p className="rounded-[8px] bg-danger-500/8 px-3 py-2 text-xs font-medium text-danger-600" role="alert">
                    Peşinat ve ara ödemeler liste fiyatını aşıyor — taksite tutar kalmadı.
                  </p>
                ) : null}

                {error ? (
                  <p className="rounded-[8px] bg-danger-500/8 px-3 py-2 text-sm font-medium text-danger-600" role="alert">
                    {error}
                  </p>
                ) : null}

                <div className="flex justify-end">
                  <Button size="sm" loading={pending} disabled={!previewOk} onClick={create}>
                    <CalendarClock className="h-4 w-4" /> Planı oluştur
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-sm text-text-muted">
                Ödeme planı için önce dairenin liste fiyatını girin.
              </p>
            )}
          </div>
        ) : (
          <p className="mt-3 text-sm text-text-muted">Bu daire için ödeme planı oluşturulmadı.</p>
        )
      ) : (
        <div className="mt-3 space-y-3">
          {/* Özet + ilerleme */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-text-muted">
            <span>
              Toplam <strong className="numeric text-ink-950">{money(total)}</strong>
              {" · Ödenen "}
              <strong className="numeric text-mint-700">{money(paidSum)}</strong>
              {" · Kalan "}
              <strong className="numeric text-ink-950">{money(total - paidSum)}</strong>
            </span>
            <span className="numeric">%{progress}</span>
          </div>
          <div
            className="h-1.5 overflow-hidden rounded-full bg-ink-950/10"
            role="progressbar"
            aria-label="Tahsilat ilerlemesi"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="h-full rounded-full bg-mint-500 transition-all" style={{ width: `${progress}%` }} />
          </div>

          {/* Satırlar */}
          <ul className="divide-y divide-line overflow-hidden rounded-[10px] border border-line bg-surface">
            {rows.map((p) => {
              const late = isLate(p);
              return (
                <li
                  key={p.id}
                  className={`flex items-center gap-3 px-3 py-2 text-sm ${late ? "bg-danger-500/5" : ""}`}
                >
                  <span className={`w-24 shrink-0 text-xs font-semibold ${late ? "text-danger-600" : "text-text-muted"}`}>
                    {fmtDate(p.due_date)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold text-ink-950">
                    {KIND_LABELS[p.kind] ?? p.kind}
                    {p.kind === "taksit" ? ` ${p.seq}` : ""}
                  </span>
                  <span className={`numeric shrink-0 text-xs font-bold ${late ? "text-danger-600" : "text-ink-950"}`}>
                    {money(Number(p.amount))}
                  </span>
                  <Badge size="sm" variant={STATUS_META[p.status].variant}>
                    {STATUS_META[p.status].label}
                  </Badge>
                  {canEdit ? (
                    p.status === "paid" ? (
                      <Button size="sm" variant="ghost" loading={pending} onClick={() => toggle(p.id)} title="Ödemeyi geri al">
                        <Undo2 className="h-3.5 w-3.5" />
                      </Button>
                    ) : (
                      <Button size="sm" variant="secondary" loading={pending} onClick={() => toggle(p.id)}>
                        <CheckCircle2 className="h-3.5 w-3.5" /> Ödendi
                      </Button>
                    )
                  ) : null}
                </li>
              );
            })}
          </ul>

          {error ? (
            <p className="rounded-[8px] bg-danger-500/8 px-3 py-2 text-sm font-medium text-danger-600" role="alert">
              {error}
            </p>
          ) : null}

          {canEdit && paidCount === 0 ? (
            <div className="flex justify-end">
              <ConfirmDialog
                title="Ödeme planı silinsin mi?"
                description="Tüm plan satırları silinir; işlem denetim kaydına yazılır. Ödeme alınmış planlar silinemez."
                confirmLabel="Planı sil"
                formAction={async (fd) => {
                  await deletePaymentPlan(fd);
                  reload();
                  router.refresh();
                }}
                hiddenFields={{ unit_id: unitId }}
                trigger={
                  <Button size="sm" variant="ghost">
                    <Trash2 className="h-3.5 w-3.5" /> Planı sil
                  </Button>
                }
              />
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
