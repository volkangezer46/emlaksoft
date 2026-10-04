"use client";

import { exportActivityCsv } from "@/app/actions/platform-activity-export";
import { ExportButton } from "@/components/admin/export-button";

/** Ekrandaki süzgeci (URL parametreleri) CSV dışa aktarmaya taşır. */
export function ActivityExportButton({ params }: { params: Record<string, string | undefined> }) {
  return <ExportButton action={() => exportActivityCsv(params)} label="CSV indir" />;
}
