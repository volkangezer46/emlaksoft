/**
 * Kira artışı hesabı — saf fonksiyonlar. ORAN VERİSİ GÖMÜLÜ DEĞİL.
 *
 * Yasal artış üst sınırı, çağıranın verdiği 12 aylık TÜFE ortalaması
 * (yüzde) ile hesaplanır. Oran TÜİK'ten/DB'den gelir; güncel oran ve
 * konut/işyeri ayrımı için mevzuat doğrulanmalıdır
 * (bkz. docs/TURKIYE_UYUM_NOTLARI.md). Tarihler `YYYY-MM-DD` metnidir;
 * "bugün" çağıran tarafından (src/lib/clock.ts) verilir.
 */

export type RentIncreaseInput = {
  /** Mevcut aylık kira (TL). */
  currentRent: number;
  /** 12 aylık TÜFE ortalaması, yüzde (ör. 45.5). Kaynak: çağıran. */
  cpiAverage12m: number;
  /** Taraflarca kararlaştırılmış artış oranı (yüzde); varsa tavanla kıyaslanır. */
  agreedRatePct?: number;
};

export type RentIncreaseResult = {
  valid: boolean;
  reason?: string;
  /** İzin verilen en yüksek artış oranı (yüzde). */
  maxRatePct: number;
  /** İzin verilen en yüksek yeni kira (kuruşa yuvarlı). */
  maxNewRent: number;
  /** Tavana göre en fazla artış tutarı. */
  maxIncreaseAmount: number;
  /** `agreedRatePct` verildiyse ve tavanı aşıyorsa true. */
  agreedExceeds: boolean;
  /** Anlaşılan orana göre yeni kira (tavanı aşsa da ham değer). */
  agreedNewRent: number | null;
  /** Uygulanabilir yeni kira (anlaşılan oran tavanı aşıyorsa tavana kırpılır). */
  effectiveNewRent: number;
};

export function roundKurus(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function invalid(reason: string): RentIncreaseResult {
  return {
    valid: false,
    reason,
    maxRatePct: 0,
    maxNewRent: 0,
    maxIncreaseAmount: 0,
    agreedExceeds: false,
    agreedNewRent: null,
    effectiveNewRent: 0,
  };
}

export function computeRentIncrease(input: RentIncreaseInput): RentIncreaseResult {
  const { currentRent, cpiAverage12m, agreedRatePct } = input;
  if (!Number.isFinite(currentRent) || currentRent <= 0) return invalid("Mevcut kira sıfırdan büyük olmalı.");
  if (!Number.isFinite(cpiAverage12m)) return invalid("TÜFE ortalaması girilmedi.");
  if (cpiAverage12m < 0) return invalid("TÜFE ortalaması negatif olamaz.");
  if (agreedRatePct !== undefined && (!Number.isFinite(agreedRatePct) || agreedRatePct < 0)) {
    return invalid("Anlaşılan artış oranı geçersiz.");
  }

  const maxNewRent = roundKurus(currentRent * (1 + cpiAverage12m / 100));
  const agreedNewRent =
    agreedRatePct === undefined ? null : roundKurus(currentRent * (1 + agreedRatePct / 100));
  const agreedExceeds = agreedNewRent !== null && agreedNewRent > maxNewRent;

  return {
    valid: true,
    maxRatePct: roundKurus(cpiAverage12m),
    maxNewRent,
    maxIncreaseAmount: roundKurus(maxNewRent - currentRent),
    agreedExceeds,
    agreedNewRent,
    effectiveNewRent: agreedNewRent === null || agreedExceeds ? maxNewRent : agreedNewRent,
  };
}

type Ymd = { y: number; m: number; d: number };

function parseYmd(s: string): Ymd | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1) return null;
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d > dim) return null;
  return { y, m, d };
}

function fmt({ y, m, d }: Ymd): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Ay ekler; gün ay sonunu aşarsa ayın son gününe çeker. */
function addMonths(p: Ymd, months: number): Ymd {
  const total = p.y * 12 + (p.m - 1) + months;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { y, m, d: Math.min(p.d, dim) };
}

function cmp(a: Ymd, b: Ymd): number {
  return a.y - b.y || a.m - b.m || a.d - b.d;
}

/**
 * Bir sonraki artış tarihi: kira başlangıcından itibaren 12 aylık dönüm
 * noktalarının, `today`'e eşit ya da sonrasındaki ilki. Başlangıç gelecekte
 * ise ilk artış başlangıç + 12 aydır. Geçersiz girdide null.
 */
export function nextIncreaseDate(startDate: string, today: string): string | null {
  const start = parseYmd(startDate);
  const t = parseYmd(today);
  if (!start || !t) return null;
  let n = 1;
  let next = addMonths(start, 12);
  while (cmp(next, t) < 0) {
    n += 1;
    next = addMonths(start, 12 * n);
  }
  return fmt(next);
}

/** Artış tarihine kalan gün (bugünse 0). Geçersiz girdide null. */
export function daysUntilIncrease(startDate: string, today: string): number | null {
  const next = nextIncreaseDate(startDate, today);
  const t = parseYmd(today);
  const n = next ? parseYmd(next) : null;
  if (!t || !n) return null;
  const ms = Date.UTC(n.y, n.m - 1, n.d) - Date.UTC(t.y, t.m - 1, t.d);
  return Math.round(ms / 86_400_000);
}

const TR_MONTHS = [
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
];

/** Artış dönemi: sözleşme yenileme ayı (1-12) ve Türkçe adı. */
export function renewalMonth(startDate: string): { month: number; name: string } | null {
  const s = parseYmd(startDate);
  if (!s) return null;
  return { month: s.m, name: TR_MONTHS[s.m - 1] };
}
