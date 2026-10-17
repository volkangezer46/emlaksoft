import type { ImportCounters, PlannedRow, RowStatus } from "@/lib/import-rows";

/**
 * İçe aktarma GÖRÜNÜM yardımcıları (SAF, bağımlılıksız): sayaçlar, durum etiketi ve hatalı satır CSV'si. İstemci sihirbazı
 * bunları buradan alır; doğrulama/planlama çekirdeği (`import-rows.ts`, telefon kuralları ve talep ölçütleriyle) istemci
 * paketine girmez. `import-rows.ts` aynı adları yeniden dışa aktarır (sunucu çağıranları değişmez).
 */

export function emptyCounters(): ImportCounters {
  return { total: 0, new: 0, update: 0, skip: 0, error: 0, warning: 0 };
}

export function countPlanned(rows: Pick<PlannedRow, "status" | "issues">[]): ImportCounters {
  const c = emptyCounters();
  for (const r of rows) {
    c.total += 1;
    c[r.status] += 1;
    if (r.status !== "error" && r.issues.some((i) => i.level === "warning")) c.warning += 1;
  }
  return c;
}

// ---------------------------------------------------------------------------
// Rapor (CSV)
// ---------------------------------------------------------------------------

const STATUS_LABEL: Record<RowStatus, string> = {
  new: "Yeni",
  update: "Güncellenecek",
  skip: "Atlandı",
  error: "Hatalı",
};

export function statusLabel(s: RowStatus): string {
  return STATUS_LABEL[s];
}

function csvCell(v: string): string {
  return /[",;\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * Hatalı (ve istenirse atlanan) satırları, ORİJİNAL dosya sütunlarıyla birlikte CSV'ye çevirir;
 * kullanıcı düzeltip aynı dosyayı yeniden yükleyebilir. Excel TR için BOM + noktalı virgül.
 */
export function buildIssueCsv(
  headers: string[],
  sourceRows: string[][],
  planned: Pick<PlannedRow, "row" | "status" | "issues">[],
  include: RowStatus[] = ["error"],
): string {
  const head = ["Satır", "Durum", "Sebep", ...headers].map(csvCell).join(";");
  const lines = [head];
  for (const p of planned) {
    if (!include.includes(p.status)) continue;
    const src = sourceRows[p.row - 2] ?? [];
    const reason = p.issues.map((i) => i.message).join(" | ");
    lines.push(
      [String(p.row), statusLabel(p.status), reason, ...headers.map((_, i) => src[i] ?? "")].map(csvCell).join(";"),
    );
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}
