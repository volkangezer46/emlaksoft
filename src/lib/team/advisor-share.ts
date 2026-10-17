/**
 * Danışman payı hesabı — tek kaynak (Cüzdanım ve Ekip Merkezi / Kazanç sekmesi).
 *
 * `commissions.splits` jsonb `[{label, rate}]` taşır; satırlarda danışman
 * PROFİL ID'Sİ YOK, taraflar serbest metin etiket (split editörü böyle
 * kaydediyor). Bu yüzden pay üç kademede belirlenir:
 *
 * 1. Etiketi kullanıcının tam adıyla birebir eşleşen split satır(lar)ı varsa
 *    pay = brüt × oran (adına yazılmış paylaşım en güvenilir kaynak).
 * 2. Ad eşleşmesi yoksa ama bağlı anlaşma kullanıcıya atanmışsa
 *    (`deals.assigned_to`), jenerik "Danışman" etiketli satırın oranı kullanılır
 *    (editörün varsayılan şablonu bu etiketi üretir).
 * 3. Paylaşım hiç tanımlanmamışsa ve anlaşma kullanıcıya atanmışsa brüt tutarın
 *    tamamı "paylaşım bekliyor" notuyla gösterilir.
 *
 * Bunların hiçbiri tutmayan kayıtlar danışmanın kazancına girmez.
 * (Kalıcı çözüm: splits satırlarına profile_id — Faz 2.)
 */
import { TR_OFFSET_MS } from "@/lib/clock";

export type SplitEntry = { label?: string; amount?: number; rate?: number; profile_id?: string | null };

/**
 * B7: ad etiketi tek başına KİMLİK DEĞİLDİR (profil adı kullanıcı tarafından değiştirilebilir, iki kişi aynı
 * adı taşıyabilir). Bu yüzden etiket eşleşmesi yalnız anlaşma bu kullanıcıya atanmışsa (`deal.assigned_to`)
 * geçerlidir; satırda `profile_id` varsa o kesin kimliktir ve etiketten önce gelir.
 */
export type ShareOptions = {
  /** Ofiste birden fazla kişinin taşıdığı tam adlar: eşleşme payı belirsiz, notta uyarılır. */
  ambiguousNames?: ReadonlySet<string>;
};

/** Aynı (büyük/küçük harf duyarsız) adı taşıyan birden çok kişi varsa o adlar. */
export function findAmbiguousNames(names: readonly (string | null | undefined)[]): Set<string> {
  const seen = new Map<string, string>();
  const dup = new Set<string>();
  for (const raw of names) {
    const n = (raw ?? "").trim();
    if (!n) continue;
    const key = n.toLocaleLowerCase("tr");
    const first = seen.get(key);
    if (first !== undefined) {
      dup.add(first);
      dup.add(n);
    } else {
      seen.set(key, n);
    }
  }
  return dup;
}

type DealRel = { assigned_to: string | null } | { assigned_to: string | null }[] | null;

export type ShareRow = {
  gross_amount: number | string;
  status: string;
  splits: SplitEntry[] | null;
  deal: DealRel;
};

export function dealOf<T extends { assigned_to: string | null }>(value: T | T[] | null): T | null | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function isPaid(status: string) {
  return status === "paid" || status === "collected";
}

export function advisorShare(
  row: Pick<ShareRow, "gross_amount" | "splits" | "deal">,
  fullName: string | null,
  userId: string,
  opts: ShareOptions = {},
): { amount: number; note: string } | null {
  const gross = Number(row.gross_amount) || 0;
  const assignedToMe = dealOf(row.deal)?.assigned_to === userId;
  const splits = Array.isArray(row.splits) ? row.splits : [];

  if (splits.length > 0) {
    // Kesin kimlik: satırda profile_id varsa yalnız o eşleşir (etiket yok sayılır).
    const byId = splits.filter((s) => s.profile_id === userId);
    if (byId.length > 0) {
      const rate = byId.reduce((sum, s) => sum + (Number(s.rate) || 0), 0);
      return { amount: Math.round(gross * (rate / 100)), note: `%${rate} pay` };
    }
    // Etiket eşleşmesi: kimliği olmayan satırlarda ve yalnız kendi anlaşmasında.
    const named = fullName && assignedToMe ? splits.filter((s) => !s.profile_id && s.label === fullName) : [];
    if (named.length > 0) {
      const rate = named.reduce((sum, s) => sum + (Number(s.rate) || 0), 0);
      const warn = fullName && opts.ambiguousNames?.has(fullName) ? " · aynı adlı kişi var, doğrulayın" : "";
      return { amount: Math.round(gross * (rate / 100)), note: `%${rate} pay${warn}` };
    }
    if (assignedToMe) {
      const generic = splits.find((s) => s.label === "Danışman");
      if (generic) {
        const rate = Number(generic.rate) || 0;
        return { amount: Math.round(gross * (rate / 100)), note: `%${rate} pay (Danışman)` };
      }
    }
    return null;
  }

  if (assignedToMe) return { amount: gross, note: "Paylaşım tanımsız · brüt" };
  return null;
}

export type AdvisorEarning = {
  /** Kayıt sayısı (payı olan komisyon satırı). */
  count: number;
  /** Tahsil edilmemiş (calculated) pay toplamı. */
  pending: number;
  /** Tahsil edilmiş (paid/collected) pay toplamı. */
  collected: number;
};

/**
 * Bir danışmanın komisyon satırlarından kazancı: tahmini (bekleyen) ve kesinleşmiş (tahsil).
 * Danışmana ödeme (hakediş) bugün ayrı durum DEĞİL — burada gösterilen müşteriden tahsilattır.
 */
export function summarizeAdvisorEarning(
  rows: readonly ShareRow[],
  fullName: string | null,
  userId: string,
  opts: ShareOptions = {},
): AdvisorEarning {
  const out: AdvisorEarning = { count: 0, pending: 0, collected: 0 };
  for (const row of rows) {
    const share = advisorShare(row, fullName, userId, opts);
    if (!share) continue;
    out.count += 1;
    if (isPaid(row.status)) out.collected += share.amount;
    else out.pending += share.amount;
  }
  return out;
}

/** Türkiye takvimine göre "YYYY-AA" ay anahtarı (`clock.ts` TR_OFFSET_MS). */
function trMonthKeyOf(iso: string): string {
  const d = new Date(Date.parse(iso) + TR_OFFSET_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export type OwnShareSummary = {
  /** `keys` sırasıyla aylık PAY toplamı (tahakkuk: tüm durumlar). Son eleman = bu ay. */
  monthTotals: number[];
  /** `keys` aylarında tahsil edilmiş (paid/collected) pay. */
  paid: number;
  /** `keys` aylarında tahsil edilmemiş pay. */
  pending: number;
};

/**
 * KENDİ PAYIM — ana ekran "Bu ay kazancım", "Hedefime kalan", takım lideri kartı ve /app/kazancim AYNI hesabı kullanır
 * (F1): satır başına `advisorShare` (split oranı; `profile_id` eşleşmesi anlaşma bana atanmamış olsa da geçerli), ay
 * anahtarı komisyon kaydının oluştuğu TR ayı. Eskiden ana ekran brüt tutarı (`gross_amount`) topluyordu.
 */
export function summarizeOwnShare(
  rows: readonly (Pick<ShareRow, "gross_amount" | "splits" | "deal" | "status"> & { created_at: string })[],
  fullName: string | null,
  userId: string,
  keys: readonly string[],
  opts: ShareOptions = {},
): OwnShareSummary {
  const index = new Map(keys.map((k, i) => [k, i]));
  const monthTotals = keys.map(() => 0);
  let paid = 0;
  let pending = 0;
  for (const row of rows) {
    const i = index.get(trMonthKeyOf(row.created_at));
    if (i === undefined) continue;
    const share = advisorShare(row, fullName, userId, opts);
    if (!share) continue;
    monthTotals[i] += share.amount;
    if (isPaid(row.status)) paid += share.amount;
    else pending += share.amount;
  }
  return { monthTotals, paid, pending };
}
