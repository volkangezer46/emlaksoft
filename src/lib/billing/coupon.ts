/** Kupon doğrulama ve indirim hesabı (saf; SQL redeem_coupon ile birebir aynı kural). */

export type CouponKind = "percent" | "amount";

export const COUPON_CODE_RE = /^[A-Z0-9_-]{3,32}$/;

export function normalizeCouponCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

/** İndirim, ödenecek tutarı en az 1 TRY bırakır; negatif olamaz. */
export function computeCouponDiscount(kind: CouponKind, value: number, baseAmountTry: number): number {
  if (!(baseAmountTry > 0) || !(value > 0)) return 0;
  const raw = kind === "percent" ? Math.round(baseAmountTry * value) / 100 : Math.min(value, baseAmountTry);
  const capped = Math.min(raw, baseAmountTry - 1);
  return Math.max(0, Math.round(capped * 100) / 100);
}

export type CouponInput = {
  code: string;
  description: string;
  kind: CouponKind;
  value: number;
  maxRedemptions: number | null;
  validFrom: string | null;
  validUntil: string | null;
  planIds: string[];
};

/** Panel formundan kupon doğrular; geçersizde açık hata döner. */
export function parseCouponForm(f: Record<string, string | undefined>, validPlanIds: readonly string[]): { coupon: CouponInput } | { error: string } {
  const code = normalizeCouponCode(f.code ?? "");
  if (!COUPON_CODE_RE.test(code)) return { error: "Kod 3-32 karakter; yalnız A-Z, 0-9, - ve _ kullanılır." };
  const kind = f.kind === "amount" ? "amount" : f.kind === "percent" ? "percent" : null;
  if (!kind) return { error: "İndirim türü seçin." };
  const valueRaw = (f.value ?? "").trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(valueRaw)) return { error: "İndirim değeri geçersiz." };
  const value = Number(valueRaw);
  if (!(value > 0)) return { error: "İndirim değeri sıfırdan büyük olmalı." };
  if (kind === "percent" && value > 100) return { error: "Yüzde indirim en fazla 100 olabilir." };
  if (kind === "amount" && value > 1_000_000) return { error: "Tutar indirimi çok yüksek." };
  const maxRaw = (f.max_redemptions ?? "").trim();
  let maxRedemptions: number | null = null;
  if (maxRaw) {
    if (!/^\d+$/.test(maxRaw) || Number(maxRaw) < 1 || Number(maxRaw) > 1_000_000) return { error: "Kullanım sınırı pozitif tam sayı olmalı." };
    maxRedemptions = Number(maxRaw);
  }
  const date = (v: string | undefined) => {
    const t = (v ?? "").trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
  };
  const validFrom = date(f.valid_from);
  const validUntil = date(f.valid_until);
  if (validFrom && validUntil && validUntil <= validFrom) return { error: "Bitiş tarihi başlangıçtan sonra olmalı." };
  const planIds = (f.plan_ids ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (planIds.some((p) => !validPlanIds.includes(p))) return { error: "Geçersiz paket seçimi." };
  const description = (f.description ?? "").trim().slice(0, 200);
  return { coupon: { code, description, kind, value, maxRedemptions, validFrom, validUntil, planIds } };
}
