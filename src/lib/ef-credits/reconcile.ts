/**
 * EmlakFiyati kontor MUTABAKATI (saf mantik; ag/DB yok). EF `GET /kullanim` `toplam.degerleme` / `toplam.pdf`
 * (son 31 gun, EF sunucu saati; bkz. EF_RECONCILE_FIELDS) ile Emlaksoft defteri (`ef_credit_reservations` state='committed')
 * karsilastirilir. Kalem esleme: degerleme = item `valuation_*`, pdf = item `pdf_first` (tekrar indirmeler ve `report_detail`
 * sayilmaz). Drift esigi = tolerans (varsayilan 2): |fark| <= tolerans ok, aksi halde drift.
 */

export const EF_RECONCILE_WINDOW_DAYS = 31;
/** Gun siniri kaymasi (EF kayit saati vs settled_at) ve uctaki yarim kalan istekler icin kabul edilen fark (adet). */
export const EF_RECONCILE_DEFAULT_TOLERANCE = 2;

export type EfReconcileStatus = "ok" | "drift" | "error";

export type EfReconcileCounts = { degerleme: number | null; pdf: number | null };

export type EfReconcileResult = {
  status: EfReconcileStatus;
  efDegerleme: number | null;
  efPdf: number | null;
  ledgerDegerleme: number;
  ledgerPdf: number;
  /** ef - ledger; pozitif = EF daha fazla sayiyor (Emlaksoft eksik kesinlestirmis olabilir). null = EF verisi yok. */
  diffDegerleme: number | null;
  diffPdf: number | null;
  reasons: string[];
};

/** Rezerv satir listesinden (yalniz committed) kalem bazli sayim. */
export function countCommittedByItem(rows: ReadonlyArray<{ item: string; state: string }>): { degerleme: number; pdf: number } {
  let degerleme = 0;
  let pdf = 0;
  for (const r of rows) {
    if (r.state !== "committed") continue;
    if (r.item.startsWith("valuation_")) degerleme += 1;
    else if (r.item === "pdf_first") pdf += 1;
  }
  return { degerleme, pdf };
}

function normTolerance(t: number | undefined): number {
  return typeof t === "number" && Number.isFinite(t) && t >= 0 ? Math.floor(t) : EF_RECONCILE_DEFAULT_TOLERANCE;
}

/**
 * SAF karsilastirma. EF alani null ise o kalem karsilastirilamaz: sonuc "error" (sessizce "ok" sayilmaz).
 */
export function compareReconciliation(
  ef: EfReconcileCounts,
  ledger: { degerleme: number; pdf: number },
  opts?: { tolerance?: number },
): EfReconcileResult {
  const tol = normTolerance(opts?.tolerance);
  const reasons: string[] = [];
  const diff = (e: number | null, l: number) => (e === null || !Number.isFinite(e) ? null : e - l);
  const diffDegerleme = diff(ef.degerleme, ledger.degerleme);
  const diffPdf = diff(ef.pdf, ledger.pdf);
  let status: EfReconcileStatus = "ok";
  if (diffDegerleme === null || diffPdf === null) {
    status = "error";
    reasons.push("EmlakFiyati toplamlari eksik");
  } else {
    if (Math.abs(diffDegerleme) > tol) reasons.push(`degerleme farki ${diffDegerleme > 0 ? "+" : ""}${diffDegerleme}`);
    if (Math.abs(diffPdf) > tol) reasons.push(`pdf farki ${diffPdf > 0 ? "+" : ""}${diffPdf}`);
    if (reasons.length) status = "drift";
  }
  return {
    status,
    efDegerleme: ef.degerleme,
    efPdf: ef.pdf,
    ledgerDegerleme: ledger.degerleme,
    ledgerPdf: ledger.pdf,
    diffDegerleme,
    diffPdf,
    reasons,
  };
}

/** Heartbeat/bildirim metni (kisisel veri yok). */
export function describeReconciliation(r: EfReconcileResult): string {
  if (r.status === "error") return `mutabakat yapilamadi: ${r.reasons.join(", ") || "bilinmeyen"}`;
  const head = `EF ${r.efDegerleme}/${r.efPdf} (degerleme/pdf), defter ${r.ledgerDegerleme}/${r.ledgerPdf}`;
  return r.status === "ok" ? `uyumlu: ${head}` : `SAPMA: ${head}; ${r.reasons.join(", ")}`;
}
