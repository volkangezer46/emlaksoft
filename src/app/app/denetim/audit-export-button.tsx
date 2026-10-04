"use client";

import { exportAuditCsvFiltered } from "@/app/actions/audit-export";
import { ExportCsvButton } from "@/components/app/export-csv-button";
import type { AuditFilters } from "@/lib/audit-filters";

/** Ekrandaki filtreyi CSV'ye taşır. */
export function AuditExportButton({ filters, filtered }: { filters: AuditFilters; filtered: boolean }) {
  return (
    <ExportCsvButton
      label={filtered ? "Filtreli CSV dışa aktar" : "CSV dışa aktar"}
      action={() => exportAuditCsvFiltered(filters)}
    />
  );
}
