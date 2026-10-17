import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * ÖRNEK VERİ KİLİDİ — "demo silinip gerçek kayıt yüklenince tekrar demo yüklenemez" (sahip kuralı).
 *
 * Kural (SQL eşi `public.sample_seed_guard`, migration 20261024020000; tetikleyici aynı kuralla is_sample=true müşteri/portföy
 * eklemesini reddeder — uygulama kapısı atlansa bile DB kabul etmez):
 *  1. Ofis gerçek kullanıma geçtiyse (`tenants.real_use_at` dolu) → KİLİTLİ.
 *  2. Ofiste gerçek (is_sample=false) müşteri ya da portföy varsa (silinmiş dahil) → KİLİTLİ.
 *  3. İstisna yalnız platform süper admininin verdiği kısa süreli izindir (`sample_seed_override_until`) ve YALNIZ gerçek
 *     kaydı olmayan ofiste geçerlidir (2. madde istisnasızdır).
 *  4. Genel demo ofisi (slug demo-ofis) bu kilidin dışındadır (gece sıfırlaması kendi kapısıyla çalışır).
 */

export type SampleLockState = {
  realUseAt: string | null;
  overrideUntil: string | null;
  realRecords: number;
  isDemoTenant: boolean;
};

export type SampleLockCode = "real_use" | "real_records";

export type SampleLockDecision = { allowed: true; override: boolean } | { allowed: false; code: SampleLockCode; reason: string };

export const LOCK_MESSAGES: Record<SampleLockCode, string> = {
  real_use: "Ofis gerçek kullanıma geçti; örnek veri bir daha yüklenemez.",
  real_records: "Ofiste gerçek kayıtlar var; örnek veri yalnız gerçek kaydı olmayan ofise yüklenebilir.",
};

export function sampleSeedDecision(s: SampleLockState, nowMs: number): SampleLockDecision {
  if (s.isDemoTenant) return { allowed: true, override: false };
  if (s.realRecords > 0) return { allowed: false, code: "real_records", reason: LOCK_MESSAGES.real_records };
  if (s.realUseAt) {
    const until = s.overrideUntil ? Date.parse(s.overrideUntil) : NaN;
    if (Number.isFinite(until) && until > nowMs) return { allowed: true, override: true };
    return { allowed: false, code: "real_use", reason: LOCK_MESSAGES.real_use };
  }
  return { allowed: true, override: false };
}

/** UI: "örnek veri yükle / yenile" düğmeleri yalnız kilit yokken çizilir. */
export function isSampleLocked(s: Pick<SampleLockState, "realUseAt" | "realRecords" | "isDemoTenant">): boolean {
  if (s.isDemoTenant) return false;
  return Boolean(s.realUseAt) || s.realRecords > 0;
}

type Db = Pick<SupabaseClient, "from" | "rpc">;

/**
 * Kilit durumunu okur: önce `sample_seed_guard` RPC (tek tur, DB kuralı); yoksa (migration uygulanmamış) iki sayım +
 * ofis satırı. Okuma hatasında güvenli taraf: KİLİTLİ sayılır (yazma yerine reddetme).
 */
export async function loadSampleLockState(db: Db, tenantId: string): Promise<SampleLockState> {
  const { data, error } = await db.rpc("sample_seed_guard", { p_tenant_id: tenantId });
  if (!error && data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    return {
      realUseAt: typeof d.real_use_at === "string" ? d.real_use_at : null,
      overrideUntil: typeof d.override_until === "string" ? d.override_until : null,
      realRecords: Number(d.real_records ?? 0) || 0,
      isDemoTenant: d.demo_tenant === true,
    };
  }
  const [tenant, cust, prop] = await Promise.all([
    db.from("tenants").select("slug, sample_cleared_at, sample_seeded_at").eq("id", tenantId).maybeSingle(),
    db.from("customers").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("is_sample", false),
    db.from("properties").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("is_sample", false),
  ]);
  if (tenant.error || cust.error || prop.error) {
    return { realUseAt: "okunamadı", overrideUntil: null, realRecords: 1, isDemoTenant: false };
  }
  const t = (tenant.data ?? {}) as { slug?: string | null; sample_cleared_at?: string | null; sample_seeded_at?: string | null };
  return {
    realUseAt: t.sample_cleared_at && !t.sample_seeded_at ? t.sample_cleared_at : null,
    overrideUntil: null,
    realRecords: (cust.count ?? 0) + (prop.count ?? 0),
    isDemoTenant: t.slug === "demo-ofis",
  };
}
