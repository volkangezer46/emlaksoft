/**
 * OFİSE ÖZEL LİMİT İSTİSNASI (entitlement override): SAF KURALLAR (I/O yok; istemci ve sunucu paylaşır).
 *
 * SON HAKEM SQL'dir: `public.tenant_entitlement_resolve(tenant, key, plan_limit)` (20261013004000) kapasite
 * tetikleyicileri ve `effective_seat_limit()` tarafından çağrılır. Buradaki kopya Ofis 360 ekranındaki önizleme ve
 * birim testi içindir; değiştirirsen ikisini birlikte değiştir.
 *
 *  - Etkin limit = (en yeni AKTİF sabit değer, yoksa plan limiti) + AKTİF artışların toplamı; en az 1.
 *  - Plan sınırsızsa (null) sınırsız kalır (istisna sınır KOYMAZ).
 *  - Aktif = geri alınmamış ve (bitişi yok ya da bitiş > şimdi). Bitiş anında eski limit kendiliğinden döner.
 *  - Koltukta satın alınmış ek kullanıcı (extra_seats) bu sonucun ÜSTÜNE eklenir (SQL ile aynı sıra).
 */

export const ENTITLEMENT_KEYS = ["seats", "active_properties", "customers", "branches"] as const;
export type EntitlementKey = (typeof ENTITLEMENT_KEYS)[number];

export const ENTITLEMENT_LABELS: Record<EntitlementKey, string> = {
  seats: "Kullanıcı (koltuk)",
  active_properties: "Aktif portföy",
  customers: "Müşteri",
  branches: "Şube",
};

/** Tek istisnada en çok artış (SQL CHECK ile aynı). */
export const OVERRIDE_DELTA_MAX = 10_000;
/** Sabit değer üst sınırı (SQL CHECK ile aynı). */
export const OVERRIDE_VALUE_MAX = 1_000_000;
/** Çözülmüş limitin tavanı (SQL `least(1000000, ...)`). */
export const RESOLVED_LIMIT_MAX = 1_000_000;

export type EntitlementOverride = {
  id: string;
  key: EntitlementKey;
  /** +N (plan limitine eklenir). `value` ile birlikte dolu olamaz. */
  delta: number | null;
  /** Plan limiti yerine geçen sabit değer. */
  value: number | null;
  expiresAtMs: number | null;
  revokedAtMs: number | null;
  createdAtMs: number;
};

export function isEntitlementKey(v: unknown): v is EntitlementKey {
  return typeof v === "string" && (ENTITLEMENT_KEYS as readonly string[]).includes(v);
}

export function isOverrideActive(o: Pick<EntitlementOverride, "expiresAtMs" | "revokedAtMs">, nowMs: number): boolean {
  if (o.revokedAtMs != null) return false;
  return o.expiresAtMs == null || o.expiresAtMs > nowMs;
}

/** Bir anahtarın etkin limiti (SQL `tenant_entitlement_resolve` ile aynı). */
export function resolveEntitlementLimit(
  planLimit: number | null,
  key: EntitlementKey,
  overrides: readonly EntitlementOverride[],
  nowMs: number,
): number | null {
  if (planLimit == null) return null;
  const active = overrides.filter((o) => o.key === key && isOverrideActive(o, nowMs));
  const fixed = active
    .filter((o) => o.value != null)
    .sort((a, b) => b.createdAtMs - a.createdAtMs || (b.id < a.id ? -1 : b.id > a.id ? 1 : 0))[0];
  const base = fixed?.value ?? planLimit;
  const plus = active.reduce((sum, o) => sum + (o.delta ?? 0), 0);
  return Math.min(RESOLVED_LIMIT_MAX, Math.max(1, base + plus));
}

/** Koltuk: istisnayla çözülmüş plan limiti + satın alınmış ek kullanıcı (SQL `effective_seat_limit`). */
export function resolveSeatLimit(
  planSeats: number | null,
  extraSeats: number,
  overrides: readonly EntitlementOverride[],
  nowMs: number,
): number | null {
  const resolved = resolveEntitlementLimit(planSeats, "seats", overrides, nowMs);
  return resolved == null ? null : resolved + Math.max(0, Math.floor(extraSeats || 0));
}

export type OverrideInput = {
  key: unknown;
  kind: unknown;
  amount: unknown;
  /** "YYYY-AA-GG" (o TR gününün sonu) ya da boş (süresiz). */
  expiresDate: unknown;
};

export type ParsedOverride =
  | { ok: true; key: EntitlementKey; delta: number | null; value: number | null }
  | { ok: false; error: string };

/** Form girdisini doğrular (sunucu action'ı ve ekran aynı kuralı kullanır). Bitiş tarihi ayrıca çözülür. */
export function parseOverrideInput(input: Omit<OverrideInput, "expiresDate">): ParsedOverride {
  if (!isEntitlementKey(input.key)) return { ok: false, error: "Limit türü seçin." };
  const kind = input.kind === "value" ? "value" : input.kind === "delta" ? "delta" : null;
  if (!kind) return { ok: false, error: "İstisna biçimini seçin (+N ya da sabit değer)." };
  const raw = typeof input.amount === "number" ? String(input.amount) : typeof input.amount === "string" ? input.amount.trim() : "";
  if (!/^[0-9]{1,7}$/.test(raw)) return { ok: false, error: "Geçerli bir pozitif tam sayı girin." };
  const n = Number(raw);
  if (kind === "delta") {
    if (n < 1 || n > OVERRIDE_DELTA_MAX) return { ok: false, error: `Artış 1 ile ${OVERRIDE_DELTA_MAX} arasında olmalı.` };
    return { ok: true, key: input.key, delta: n, value: null };
  }
  if (n < 1 || n > OVERRIDE_VALUE_MAX) return { ok: false, error: `Sabit değer 1 ile ${OVERRIDE_VALUE_MAX} arasında olmalı.` };
  return { ok: true, key: input.key, delta: null, value: n };
}

/** İstisnanın kısa Türkçe açıklaması ("+5 Kullanıcı (koltuk)", "Müşteri = 2000"). */
export function describeOverride(o: Pick<EntitlementOverride, "key" | "delta" | "value">): string {
  const label = ENTITLEMENT_LABELS[o.key];
  return o.delta != null ? `+${o.delta} ${label}` : `${label} = ${o.value ?? "?"}`;
}

/** DB satırı → saf model (bozuk satır atlanır). */
export function overrideFromRow(row: Record<string, unknown>): EntitlementOverride | null {
  const key = row.key;
  if (!isEntitlementKey(key) || typeof row.id !== "string") return null;
  const ms = (v: unknown) => {
    if (typeof v !== "string") return null;
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  };
  const num = (v: unknown) => (v == null ? null : Number.isFinite(Number(v)) ? Math.floor(Number(v)) : null);
  const delta = num(row.delta);
  const value = num(row.value);
  if ((delta == null) === (value == null)) return null;
  return {
    id: row.id,
    key,
    delta,
    value,
    expiresAtMs: ms(row.expires_at),
    revokedAtMs: ms(row.revoked_at),
    createdAtMs: ms(row.created_at) ?? 0,
  };
}
