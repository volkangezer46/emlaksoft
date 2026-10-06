"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { saveTufeTable } from "@/app/actions/platform-tufe";
import type { TufeTable } from "@/lib/tufe";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";

type Row = { month: string; rate: string; official: boolean };

const inputCls =
  "w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-400 disabled:opacity-60";

/** TÜFE tablosu düzenleyici: satır = ay + oran + resmi işareti; resmi satır için doğrulama tarihi ve kaynak zorunlu. */
export function TufeForm({ initial, canEdit }: { initial: TufeTable; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [rows, setRows] = useState<Row[]>(
    Object.keys(initial.entries)
      .sort()
      .reverse()
      .map((month) => ({ month, rate: String(initial.entries[month]!.rate), official: initial.entries[month]!.official })),
  );
  const [verifiedAt, setVerifiedAt] = useState(initial.verifiedAt ?? "");
  const [source, setSource] = useState(initial.source ?? "");
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  function update(i: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function submit() {
    setNotice(null);
    const entries: Record<string, { rate: string; official: boolean }> = {};
    for (const r of rows) {
      if (!r.month.trim()) continue;
      if (entries[r.month.trim()]) {
        setNotice({ tone: "error", text: `${r.month} ayı birden fazla kez girilmiş.` });
        return;
      }
      entries[r.month.trim()] = { rate: r.rate, official: r.official };
    }
    const fd = new FormData();
    fd.set("table", JSON.stringify({ entries, verifiedAt, source }));
    start(async () => {
      const res = await saveTufeTable(fd);
      if (res.error) setNotice({ tone: "error", text: res.error });
      else {
        setNotice({ tone: "ok", text: "TÜFE tablosu kaydedildi." });
        router.refresh();
      }
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="space-y-5 rounded-[var(--radius-panel)] border border-line bg-surface p-5"
    >
      <fieldset disabled={!canEdit || pending} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor="tufe-verified">Doğrulama tarihi</label>
            <input id="tufe-verified" type="date" value={verifiedAt} onChange={(e) => setVerifiedAt(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor="tufe-source">Kaynak</label>
            <input
              id="tufe-source"
              value={source}
              maxLength={300}
              onChange={(e) => setSource(e.target.value)}
              placeholder="Örn. TÜİK TÜFE bülteni, yayın tarihi"
              className={inputCls}
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <Table className="w-full min-w-[480px] text-sm">
            <THead>
              <TR className="text-left text-xs text-text-muted">
                <TH className="pb-2 font-semibold">Ay (YYYY-AA)</TH>
                <TH className="pb-2 font-semibold">12 aylık ort. TÜFE (%)</TH>
                <TH className="pb-2 font-semibold">Resmi (teyit edildi)</TH>
                <TH className="pb-2" />
              </TR>
            </THead>
            <TBody>
              {rows.map((r, i) => (
                <TR key={i} className="border-t border-line">
                  <TD className="py-1.5 pr-2">
                    <input value={r.month} onChange={(e) => update(i, { month: e.target.value })} aria-label="Ay" placeholder="2026-08" className={inputCls} />
                  </TD>
                  <TD className="py-1.5 pr-2">
                    <input value={r.rate} onChange={(e) => update(i, { rate: e.target.value })} inputMode="decimal" aria-label="Oran" className={inputCls} />
                  </TD>
                  <TD className="py-1.5 pr-2">
                    <input type="checkbox" checked={r.official} onChange={(e) => update(i, { official: e.target.checked })} aria-label="Resmi" className="h-4 w-4 accent-brand-600" />
                    {!r.official ? <span className="ml-2 text-xs text-amber-700">Teyit edilmeli</span> : null}
                  </TD>
                  <TD className="py-1.5 text-right">
                    <button type="button" onClick={() => setRows((prev) => prev.filter((_, idx) => idx !== i))} aria-label="Satırı sil" className="rounded p-1.5 text-text-muted hover:text-danger-500">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>

        <button
          type="button"
          onClick={() => setRows((prev) => [{ month: "", rate: "", official: false }, ...prev])}
          className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-line px-3 py-2 text-xs font-semibold text-text-muted hover:border-brand-300 hover:text-brand-600"
        >
          <Plus className="h-4 w-4" /> Ay ekle
        </button>

        <div className="flex items-center justify-end gap-3 border-t border-line pt-4">
          {notice ? (
            <span role={notice.tone === "error" ? "alert" : "status"} className={`text-sm ${notice.tone === "error" ? "text-danger-500" : "font-semibold text-mint-600"}`}>
              {notice.text}
            </span>
          ) : null}
          {canEdit ? (
            <button type="submit" className="inline-flex items-center gap-2 rounded-[var(--radius-control)] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Kaydet
            </button>
          ) : (
            <span className="text-xs text-text-muted">Yalnız süper admin düzenleyebilir.</span>
          )}
        </div>
      </fieldset>
    </form>
  );
}
