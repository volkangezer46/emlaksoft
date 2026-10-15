"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, FileSpreadsheet, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormField, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/app/toast-provider";
import { decodeCsvBuffer } from "@/app/app/ice-aktarma/import-config";
import { isXlsxFile, readXlsxTable, tableToCsvText } from "@/lib/xlsx-import";
import { parseUnitPriceList, UNIT_IMPORT_LIMIT } from "@/lib/projects/unit-import";
import { importProjectUnitRows } from "@/app/actions/project-sales";

const FIELD_LABELS: Record<string, string> = {
  block: "Blok",
  floor: "Kat",
  unit_no: "Daire no",
  rooms: "Oda",
  gross_m2: "Brüt m²",
  list_price: "Fiyat",
};

function money(n: number | null) {
  return n == null ? "—" : new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(n) + " ₺";
}

/**
 * PF-05 — Müteahhit fiyat listesini içe aktarma: Excel'den kopyala-yapıştır ya da CSV/XLSX dosyası. Önce önizleme
 * (tanınan kolonlar, hatalı satırlar), sonra tek tıkla aktarım: aynı blok + daire no varsa güncellenir (satılmış
 * daire atlanır, ödeme planlı dairenin fiyatı korunur), yoksa müsait olarak eklenir. Fiyat değişimleri geçmişe yazılır.
 */
export function UnitImportForm({ projectId, onDone }: { projectId: string; onDone: () => void }) {
  const router = useRouter();
  const { push } = useToast();
  const [text, setText] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const parsed = useMemo(() => (text.trim() ? parseUnitPriceList(text) : null), [text]);

  async function onFile(file: File | undefined) {
    setFileError(null);
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setFileError("Dosya en fazla 5 MB olabilir.");
      return;
    }
    try {
      const buf = await file.arrayBuffer();
      if (isXlsxFile(file)) {
        setText(tableToCsvText(await readXlsxTable(buf)));
      } else {
        setText(decodeCsvBuffer(buf));
      }
    } catch {
      setFileError("Dosya okunamadı. Excel'de açıp satırları kopyalayıp buraya yapıştırabilirsiniz.");
    }
  }

  function submit() {
    if (!parsed || parsed.rows.length === 0) return;
    start(async () => {
      const res = await importProjectUnitRows(projectId, parsed.rows);
      if (res.error) {
        push(res.error, "err");
        return;
      }
      push(
        `${res.created ?? 0} daire eklendi, ${res.updated ?? 0} güncellendi${res.skipped ? `, ${res.skipped} atlandı (satılmış ya da geçersiz)` : ""}.`,
        "ok",
      );
      setText("");
      onDone();
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-text-muted">
        Excel&apos;deki fiyat listesini başlık satırıyla birlikte kopyalayıp yapıştırın ya da dosya seçin. Tanınan
        kolonlar: Blok, Kat, Daire no, Oda, Brüt m², Fiyat. En fazla {UNIT_IMPORT_LIMIT} satır.
      </p>
      <label className="focus-within:ring-brand-300 flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-[var(--radius-card)] border border-dashed border-line-strong bg-canvas px-4 py-3 text-sm font-semibold text-ink-950 transition hover:border-brand-300 focus-within:ring-2">
        <Upload className="h-4 w-4 text-brand-600" /> CSV ya da Excel (.xlsx) dosyası seçin
        <input
          type="file"
          accept=".csv,.txt,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="sr-only"
          onChange={(e) => onFile(e.target.files?.[0])}
        />
      </label>
      {fileError ? (
        <p role="alert" className="text-sm font-medium text-danger-600">
          {fileError}
        </p>
      ) : null}
      <FormField label="Ya da buraya yapıştırın" htmlFor="unit-import-text">
        <Textarea
          id="unit-import-text"
          rows={5}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"Blok\tKat\tDaire No\tOda\tBrüt m²\tFiyat\nA\t1\t1\t2+1\t95\t4.250.000"}
          className="font-mono text-xs"
        />
      </FormField>

      {parsed ? (
        parsed.missingUnitNo ? (
          <p role="alert" className="flex items-start gap-2 rounded-[var(--radius-control)] bg-amber-400/12 px-3 py-2 text-sm font-medium text-amber-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> &quot;Daire no&quot; kolonu bulunamadı. İlk satır başlık olmalı (ör. Blok, Kat, Daire No, Fiyat).
          </p>
        ) : (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-text-muted">
              {parsed.rows.length} satır hazır · Tanınan kolonlar: {parsed.columns.map((c) => FIELD_LABELS[c] ?? c).join(", ")}
              {parsed.truncated ? ` · ilk ${UNIT_IMPORT_LIMIT} satır alınır` : ""}
            </p>
            {parsed.rows.length > 0 ? (
              <div className="max-h-64 overflow-auto rounded-[var(--radius-card)] border border-line">
                <table className="w-full min-w-[480px] text-left text-xs">
                  <thead className="sticky top-0 bg-canvas text-text-faint">
                    <tr>
                      {["Blok", "Kat", "No", "Oda", "m²", "Fiyat"].map((h) => (
                        <th key={h} className="px-3 py-2 font-semibold">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {parsed.rows.slice(0, 50).map((r) => (
                      <tr key={r.line}>
                        <td className="px-3 py-1.5">{r.block ?? "—"}</td>
                        <td className="px-3 py-1.5">{r.floor ?? "—"}</td>
                        <td className="px-3 py-1.5 font-semibold text-ink-950">{r.unit_no}</td>
                        <td className="px-3 py-1.5">{r.rooms ?? "—"}</td>
                        <td className="numeric px-3 py-1.5">{r.gross_m2 ?? "—"}</td>
                        <td className="numeric px-3 py-1.5">{money(r.list_price)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {parsed.errors.length > 0 ? (
              <details className="rounded-[var(--radius-control)] bg-danger-500/6 px-3 py-2 text-xs text-danger-600">
                <summary className="cursor-pointer font-semibold">{parsed.errors.length} satır aktarılmayacak</summary>
                <ul className="mt-1 space-y-0.5">
                  {parsed.errors.slice(0, 20).map((e) => (
                    <li key={`${e.line}-${e.message}`}>
                      Satır {e.line}: {e.message}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        )
      ) : null}

      <div className="hairline-t flex justify-end pt-4">
        <Button onClick={submit} loading={pending} disabled={!parsed || parsed.rows.length === 0}>
          <FileSpreadsheet /> {parsed && parsed.rows.length > 0 ? `${parsed.rows.length} daireyi aktar` : "Aktar"}
        </Button>
      </div>
    </div>
  );
}
