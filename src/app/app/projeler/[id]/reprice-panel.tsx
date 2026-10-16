"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Percent, TrendingUp } from "lucide-react";
import { InlinePanel, InlinePanelTrigger } from "@/components/ui/inline-panel";
import { Button } from "@/components/ui/button";
import { FormField, Input } from "@/components/ui/input";
import { FormSelect } from "@/components/ui/form-controls";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/components/app/toast-provider";
import { parseTrDecimal } from "@/lib/money-input";
import { repriceProjectUnits, undoProjectReprice } from "@/app/actions/project-sales";
import type { UnitRow } from "@/app/actions/projects";

const PANEL_ID = "fiyat-guncelle";
const GENEL = "__genel__";

export function RepriceTrigger() {
  return (
    <InlinePanelTrigger panelId={PANEL_ID} variant="secondary">
      <TrendingUp className="h-4 w-4" /> Fiyatları güncelle
    </InlinePanelTrigger>
  );
}

function money(n: number) {
  return "₺" + new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(n);
}

/** Sunucu RPC'siyle AYNI formül (önizleme); kesin sonuç sunucudan döner. */
function nextPrice(old: number, mode: "pct" | "fixed", value: number, roundTo: number) {
  const raw = mode === "pct" ? old * (1 + value / 100) : old + value;
  const rounded = roundTo > 0 ? Math.round(raw / roundTo) * roundTo : Math.round(raw);
  return Math.max(0, rounded);
}

/**
 * PF-05 — Toplu fiyat güncelleme: blok / kat aralığı / durum süzgeci, % ya da tutar, yuvarlama, gerekçe. Önce önizleme
 * (etkilenen daire, eski → yeni toplam), sonra onay; 10 dakika içinde "Geri al". Satılmış, kaporalı ve ödeme planlı
 * daireler hiç değişmez. Her değişim daire fiyat geçmişine yazılır.
 */
export function RepricePanel({ projectId, units }: { projectId: string; units: UnitRow[] }) {
  return (
    <InlinePanel
      id={PANEL_ID}
      title="Fiyatları güncelle"
      description="Müteahhit fiyat listesi değiştiğinde müsait dairelere toplu zam ya da indirim uygulayın."
      icon={<Percent />}
    >
      {(close) => <RepriceForm projectId={projectId} units={units} onDone={close} />}
    </InlinePanel>
  );
}

function RepriceForm({ projectId, units, onDone }: { projectId: string; units: UnitRow[]; onDone: () => void }) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, start] = useTransition();
  const [block, setBlock] = useState("all");
  const [floorMin, setFloorMin] = useState("");
  const [floorMax, setFloorMax] = useState("");
  const [withReserved, setWithReserved] = useState(false);
  const [mode, setMode] = useState<"pct" | "fixed">("pct");
  const [valueRaw, setValueRaw] = useState("");
  const [roundTo, setRoundTo] = useState("1000");
  const [reason, setReason] = useState("");

  const blocks = useMemo(
    () => Array.from(new Set(units.map((u) => u.block ?? GENEL))).sort((a, b) => a.localeCompare(b, "tr")),
    [units],
  );
  const parsedValue = useMemo(() => {
    const neg = valueRaw.trim().startsWith("-");
    const r = parseTrDecimal(valueRaw.replace(/^[-+]/, "").replace("%", ""), { max: mode === "pct" ? 200 : 100_000_000_000 });
    return r.ok && r.value != null ? (neg ? -r.value : r.value) : null;
  }, [valueRaw, mode]);
  const valueError =
    valueRaw.trim() && parsedValue == null
      ? "Geçerli bir sayı girin (indirim için başına - koyun)."
      : mode === "pct" && parsedValue != null && (parsedValue < -50 || parsedValue > 200)
        ? "Oran %-50 ile %200 arasında olmalı."
        : null;

  const fMin = floorMin.trim() === "" ? null : Number.parseInt(floorMin, 10);
  const fMax = floorMax.trim() === "" ? null : Number.parseInt(floorMax, 10);
  const targets = units.filter((u) => {
    if (!(u.status === "available" || (withReserved && u.status === "reserved"))) return false;
    if (u.list_price == null || Number(u.list_price) <= 0) return false;
    if (block !== "all" && (u.block ?? GENEL) !== block) return false;
    if (fMin != null && Number.isFinite(fMin) && (u.floor == null || u.floor < fMin)) return false;
    if (fMax != null && Number.isFinite(fMax) && (u.floor == null || u.floor > fMax)) return false;
    return true;
  });
  const round = Number(roundTo);
  const oldTotal = targets.reduce((s, u) => s + Number(u.list_price), 0);
  const newTotal =
    parsedValue != null && !valueError ? targets.reduce((s, u) => s + nextPrice(Number(u.list_price), mode, parsedValue, round), 0) : null;
  const sample = targets[0];

  function apply() {
    if (parsedValue == null || valueError || targets.length === 0) return;
    start(async () => {
      const res = await repriceProjectUnits({
        projectId,
        unitIds: targets.map((u) => u.id),
        mode,
        value: parsedValue,
        roundTo: round,
        reason: reason || null,
      });
      if (res.error) {
        push(res.error, "err");
        return;
      }
      const batchId = res.batchId;
      const skipped = targets.length - (res.updated ?? 0);
      push(
        `${res.updated ?? 0} dairenin fiyatı güncellendi${skipped > 0 ? ` (${skipped} daire ödeme planı nedeniyle atlandı)` : ""}.`,
        "ok",
        batchId && (res.updated ?? 0) > 0
          ? {
              action: {
                label: "Geri al",
                onClick: async () => {
                  const undo = await undoProjectReprice(projectId, batchId);
                  if (undo.error) push(undo.error, "err");
                  else {
                    push(`${undo.restored ?? 0} dairenin fiyatı geri alındı.`, "ok");
                    router.refresh();
                  }
                },
              },
            }
          : undefined,
      );
      onDone();
      router.refresh();
    });
  }

  return (
    <div className="space-y-4 px-4 py-4 md:px-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <FormField label="Blok" htmlFor="rp-block">
          <FormSelect id="rp-block" value={block} onChange={(e) => setBlock(e.target.value)}>
            <option value="all">Tüm bloklar</option>
            {blocks.map((b) => (
              <option key={b} value={b}>
                {b === GENEL ? "Bloksuz" : `${b} Blok`}
              </option>
            ))}
          </FormSelect>
        </FormField>
        <FormField label="Kat (en az)" htmlFor="rp-fmin">
          <Input id="rp-fmin" inputMode="numeric" value={floorMin} onChange={(e) => setFloorMin(e.target.value)} placeholder="Tümü" />
        </FormField>
        <FormField label="Kat (en çok)" htmlFor="rp-fmax">
          <Input id="rp-fmax" inputMode="numeric" value={floorMax} onChange={(e) => setFloorMax(e.target.value)} placeholder="Tümü" />
        </FormField>
        <label className="flex min-h-11 items-center gap-2 self-end text-sm font-semibold text-ink-950">
          <Checkbox checked={withReserved} onChange={(e) => setWithReserved(e.target.checked)} /> Rezerve daireler de
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <FormField label="Güncelleme türü" htmlFor="rp-mode">
          <FormSelect id="rp-mode" value={mode} onChange={(e) => setMode(e.target.value === "fixed" ? "fixed" : "pct")}>
            <option value="pct">Yüzde (%)</option>
            <option value="fixed">Tutar (₺)</option>
          </FormSelect>
        </FormField>
        <FormField
          label={mode === "pct" ? "Oran (%)" : "Tutar (₺)"}
          htmlFor="rp-value"
          required
          error={valueError ?? undefined}
          hint={mode === "pct" ? "Zam için 5, indirim için -5" : "Zam için 100.000, indirim için -100.000"}
        >
          <Input id="rp-value" inputMode="decimal" value={valueRaw} onChange={(e) => setValueRaw(e.target.value)} placeholder={mode === "pct" ? "5" : "100.000"} />
        </FormField>
        <FormField label="Yuvarlama" htmlFor="rp-round">
          <FormSelect id="rp-round" value={roundTo} onChange={(e) => setRoundTo(e.target.value)}>
            <option value="0">Yuvarlama yok</option>
            <option value="1000">₺1.000</option>
            <option value="10000">₺10.000</option>
            <option value="50000">₺50.000</option>
            <option value="100000">₺100.000</option>
          </FormSelect>
        </FormField>
        <FormField label="Gerekçe" htmlFor="rp-reason" hint="Fiyat geçmişinde görünür">
          <Input id="rp-reason" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ekim fiyat listesi" />
        </FormField>
      </div>

      <div className="rounded-[var(--radius-card)] border border-line bg-canvas p-4" aria-live="polite">
        {targets.length === 0 ? (
          <p className="text-sm text-text-muted">Süzgece uyan, fiyatı girilmiş müsait daire yok.</p>
        ) : (
          <dl className="grid gap-3 sm:grid-cols-3">
            <div>
              <dt className="text-xs font-semibold text-text-faint">Etkilenecek daire</dt>
              <dd className="numeric font-display text-xl font-extrabold text-ink-950">{targets.length}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-text-faint">Toplam liste değeri</dt>
              <dd className="numeric text-sm font-bold text-ink-950">
                {money(oldTotal)}
                {newTotal != null ? (
                  <>
                    {" → "}
                    <span className={newTotal >= oldTotal ? "text-mint-700" : "text-danger-600"}>{money(newTotal)}</span>
                  </>
                ) : null}
              </dd>
            </div>
            {sample && newTotal != null && parsedValue != null ? (
              <div>
                <dt className="text-xs font-semibold text-text-faint">Örnek ({sample.block ? `${sample.block} Blok ` : ""}{sample.unit_no})</dt>
                <dd className="numeric text-sm font-bold text-ink-950">
                  {money(Number(sample.list_price))} → {money(nextPrice(Number(sample.list_price), mode, parsedValue, round))}
                </dd>
              </div>
            ) : null}
          </dl>
        )}
        <p className="mt-2 text-xs text-text-faint">Satılmış, kaporalı ve ödeme planı olan daireler değişmez. İşlemden sonra 10 dakika geri alabilirsiniz.</p>
      </div>

      <div className="hairline-t flex justify-end gap-2 pt-4">
        <Button variant="secondary" onClick={onDone}>
          Vazgeç
        </Button>
        <Button onClick={apply} loading={pending} disabled={targets.length === 0 || parsedValue == null || Boolean(valueError)}>
          <TrendingUp /> {targets.length > 0 ? `${targets.length} daireye uygula` : "Uygula"}
        </Button>
      </div>
    </div>
  );
}
