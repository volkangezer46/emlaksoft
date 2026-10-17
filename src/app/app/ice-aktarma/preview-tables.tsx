"use client";

import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import type { PlannedRowView } from "@/app/actions/import-data";
import type { RowStatus } from "@/lib/import-rows";
import { statusLabel } from "@/lib/import-rows-view";

/**
 * İçe aktarma önizleme / sonuç tabloları — sihirbaz bunları `next/dynamic` ile yalnız 3. ve 4. adımda yükler (ilk ekran
 * dosya seçimidir). Görünüm eski satır içi tablolarla birebir aynıdır.
 */
const STATUS_STYLE: Record<RowStatus, string> = {
  new: "bg-mint-500/12 text-mint-600",
  update: "bg-brand-600/10 text-brand-600",
  skip: "bg-amber-400/15 text-amber-700",
  error: "bg-danger-500/10 text-danger-600",
};

export function StatusBadge({ status }: { status: RowStatus }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[status]}`}>
      {statusLabel(status)}
    </span>
  );
}

/** İlk satırlar (doğrulanmış haliyle). Genişlik sınıfı çağıranda (mobil yatay kaydırma kapsayıcısıyla birlikte). */
export function SampleRowsTable({ rows, className }: { rows: readonly PlannedRowView[]; className?: string }) {
  return (
    <Table className={className}>
      <THead className="bg-canvas text-text-muted">
        <TR>
          <TH className="px-3 py-2 font-semibold">Satır</TH>
          <TH className="px-3 py-2 font-semibold">Durum</TH>
          <TH className="px-3 py-2 font-semibold">Kayıt</TH>
          <TH className="px-3 py-2 font-semibold">Not</TH>
        </TR>
      </THead>
      <TBody>
        {rows.map((r) => (
          <TR key={r.row} className="border-t border-line align-top">
            <TD className="numeric px-3 py-2 text-text-muted">{r.row}</TD>
            <TD className="px-3 py-2"><StatusBadge status={r.status} /></TD>
            <TD className="max-w-56 truncate px-3 py-2 text-ink-950">
              {r.label || <span className="text-text-faint">—</span>}
              {r.location ? <span className="block truncate text-text-muted">{r.location}</span> : null}
              {r.existingName ? <span className="block text-text-faint">eşleşen: {r.existingName} ({r.matchedBy})</span> : null}
            </TD>
            <TD className="px-3 py-2 text-text-muted">
              {r.issues.length ? r.issues.map((i) => i.message).join(" · ") : <span className="text-text-faint">—</span>}
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

/** Sorunlu satırlar (satır · durum · neden). */
export function IssueRowsTable({ rows }: { rows: readonly PlannedRowView[] }) {
  return (
    <Table className="w-full text-left text-xs">
      <THead className="sticky top-0 bg-canvas text-text-muted">
        <TR>
          <TH className="px-3 py-2 font-semibold">Satır</TH>
          <TH className="px-3 py-2 font-semibold">Durum</TH>
          <TH className="px-3 py-2 font-semibold">Neden</TH>
        </TR>
      </THead>
      <TBody>
        {rows.map((r) => (
          <TR key={r.row} className="border-t border-line align-top">
            <TD className="numeric px-3 py-2 text-text-muted">{r.row}</TD>
            <TD className="px-3 py-2"><StatusBadge status={r.status} /></TD>
            <TD className="px-3 py-2 text-ink-950">{r.issues.map((i) => i.message).join(" · ") || "—"}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
