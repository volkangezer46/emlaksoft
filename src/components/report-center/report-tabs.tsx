import { SegmentedControl } from "@/components/ui/segmented-control";
import { REPORT_CENTER_PATH } from "@/lib/report-center/links";
import type { ReportScope } from "@/lib/report-center/types";

/** Raporlar sayfası sekmeleri: mevcut dashboard ("Genel bakış") ↔ Rapor merkezi. Durum `?sekme=` ile URL'dedir. */
export function ReportTabs({ scope, active, overviewLabel = "Genel bakış" }: { scope: ReportScope; active: "ozet" | "merkez"; overviewLabel?: string }) {
  const base = REPORT_CENTER_PATH[scope];
  return (
    <SegmentedControl
      label="Rapor bölümü"
      value={active}
      options={[
        { value: "ozet", label: overviewLabel, href: base },
        { value: "merkez", label: "Rapor merkezi", href: `${base}?sekme=merkez` },
      ]}
      className="max-w-sm"
    />
  );
}
