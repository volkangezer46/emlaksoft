/**
 * Ay sonu kapanış kontrol listesi (SAF; DB/saat yok). Kapanacak ay (varsayılan: geçen ay) için adımlar:
 *  1) Banka mutabakatı: banka hesaplarında ekstreyle eşleşmemiş hareket kalmadı mı
 *  2) İncelenecekler: ekstre satırı, onay bekleyen düzenli ödeme, eşleşmemiş fiş
 *  3) Fişsiz gider: belgesi eklenmemiş gider hareketi
 *  4) KDV özeti: KDV bilgisi eksik hareket kalmadı mı (kalmadıysa özet hazır)
 *  5) Dönem kilidi: ay kilitlendi mi (kilitlenince o aya kayıt eklenemez/değiştirilemez)
 * Okunamayan sayı (null) "bilinmiyor" durumudur; adım tamamlanmış sayılmaz ve kilit önerilmez. Test: month-close.test.ts.
 */

export type CloseStatus = "done" | "todo" | "unknown";

export type CloseStep = {
  key: "reconcile" | "review" | "receipts" | "vat" | "lock";
  label: string;
  detail: string;
  status: CloseStatus;
  href: string;
  count: number | null;
};

export type MonthCloseInput = {
  monthKey: string;
  locked: boolean | null;
  /** Banka hesabı yoksa null değil `undefined` (adım listelenmez). */
  unreconciledBank?: number | null;
  reviewCount: number | null;
  receiptlessExpenses: number | null;
  noVatEntries: number | null;
  /** Ayın KDV özeti (ödenecek = hesaplanan − indirilecek); okunamadıysa null. */
  vatPayable: number | null;
};

export type MonthCloseLinks = {
  reconcile: string;
  review: string;
  receipts: string;
  noVat: string;
  vat: string;
  lock: string;
};

export type MonthCloseResult = {
  monthKey: string;
  steps: CloseStep[];
  done: number;
  total: number;
  /** Kilit dışındaki tüm adımlar tamam ve ay henüz kilitli değil. */
  readyToLock: boolean;
  closed: boolean;
};

/** Bugünün ("YYYY-MM-DD") bir önceki ayı ("YYYY-MM"). */
export function previousMonthKey(today: string): string {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return `${py}-${String(pm).padStart(2, "0")}`;
}

const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
export function monthNameTr(monthKey: string): string {
  return `${MONTHS[Number(monthKey.slice(5, 7)) - 1] ?? monthKey} ${monthKey.slice(0, 4)}`;
}

function countStatus(n: number | null | undefined): CloseStatus {
  if (n === null || n === undefined || !Number.isFinite(n)) return "unknown";
  return n > 0 ? "todo" : "done";
}

const tl = (n: number) =>
  new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(Math.round(n));

export function buildMonthCloseChecklist(input: MonthCloseInput, links: MonthCloseLinks): MonthCloseResult {
  const steps: CloseStep[] = [];
  if (input.unreconciledBank !== undefined) {
    const n = input.unreconciledBank;
    steps.push({
      key: "reconcile",
      label: "Banka mutabakatı",
      detail: n === null ? "Okunamadı" : n > 0 ? `${n} banka hareketi ekstreyle eşleşmedi` : "Tüm banka hareketleri eşleşti",
      status: countStatus(n),
      href: links.reconcile,
      count: n,
    });
  }
  steps.push({
    key: "review",
    label: "İncelenecek kayıtlar",
    detail: input.reviewCount === null ? "Okunamadı" : input.reviewCount > 0 ? `${input.reviewCount} kayıt inceleme bekliyor` : "İnceleme bekleyen kayıt yok",
    status: countStatus(input.reviewCount),
    href: links.review,
    count: input.reviewCount,
  });
  steps.push({
    key: "receipts",
    label: "Fiş ve faturalar",
    detail: input.receiptlessExpenses === null ? "Okunamadı" : input.receiptlessExpenses > 0 ? `${input.receiptlessExpenses} giderin belgesi eklenmedi` : "Her giderin belgesi var",
    status: countStatus(input.receiptlessExpenses),
    href: links.receipts,
    count: input.receiptlessExpenses,
  });
  const vatStatus = countStatus(input.noVatEntries);
  steps.push({
    key: "vat",
    label: "KDV özeti",
    detail:
      input.noVatEntries === null
        ? "Okunamadı"
        : input.noVatEntries > 0
          ? `${input.noVatEntries} hareketin KDV bilgisi eksik`
          : input.vatPayable === null
            ? "KDV bilgileri tam"
            : input.vatPayable >= 0
              ? `Hazır · ödenecek KDV ${tl(input.vatPayable)}`
              : `Hazır · devreden KDV ${tl(Math.abs(input.vatPayable))}`,
    status: vatStatus,
    href: vatStatus === "todo" ? links.noVat : links.vat,
    count: input.noVatEntries,
  });
  const lockStatus: CloseStatus = input.locked === null ? "unknown" : input.locked ? "done" : "todo";
  steps.push({
    key: "lock",
    label: "Dönem kilidi",
    detail: input.locked === null ? "Okunamadı" : input.locked ? "Dönem kapatıldı" : "Kontroller bitince dönemi kilitleyin",
    status: lockStatus,
    href: links.lock,
    count: null,
  });
  const done = steps.filter((s) => s.status === "done").length;
  const beforeLock = steps.filter((s) => s.key !== "lock");
  return {
    monthKey: input.monthKey,
    steps,
    done,
    total: steps.length,
    readyToLock: input.locked === false && beforeLock.every((s) => s.status === "done"),
    closed: input.locked === true,
  };
}
