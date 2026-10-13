import { z } from "zod";
import { DAY_MS } from "@/lib/clock";
import { planLabel } from "@/lib/billing/plans";
import { FEATURE_KEYS, getModuleDef, isFeatureKey } from "@/lib/modules/registry";
import { ActionUserError } from "@/lib/action-errors";

/**
 * Duyuru SEGMENTİ (AD8): hangi ofislerin hangi kullanıcılarına gidileceği. Tek kaynak: kuyruk (gönderim anında çözer),
 * banner (kayıt anında çözer), canlı sayım önizlemesi ve arşivdeki "Hedef" etiketi bu dosyayı kullanır.
 *
 * Ölçütler VE ile birleşir. Boş ölçüt = kısıt yok. İptal edilmiş ofis HER ZAMAN dışarıda (eski "tüm ofisler" kuralı).
 * Etiket ölçütü (AD5) yok: ofis etiketi tablosu henüz yok; eklendiğinde buraya tek alan olarak girer.
 *
 * Bu dosya service_role istemcisi OLUŞTURMAZ; çözümleyiciler çağıranın istemcisini alır.
 */

export const SEGMENT_STATUSES = ["trial", "active", "past_due", "suspended"] as const;
export const SEGMENT_PLANS = ["advisor", "office", "professional", "business", "enterprise"] as const;

const STATUS_LABEL: Record<(typeof SEGMENT_STATUSES)[number], string> = {
  trial: "Deneme",
  active: "Aktif",
  past_due: "Ödemesi gecikmiş",
  suspended: "Askıda",
};
export function segmentStatusLabel(s: string): string {
  return (STATUS_LABEL as Record<string, string>)[s] ?? s;
}

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

export const segmentSchema = z
  .object({
    plans: z.array(z.enum(SEGMENT_PLANS)).max(SEGMENT_PLANS.length).optional(),
    statuses: z.array(z.enum(SEGMENT_STATUSES)).max(SEGMENT_STATUSES.length).optional(),
    /** Deneme bitişine en çok N gün kalan (bitmemiş) deneme ofisleri. */
    trialEndsWithinDays: z.number().int().min(0).max(60).optional(),
    /** Son başarılı giriş: son N günde giriş YAPAN (active) ya da YAPMAYAN (inactive) ofisler. */
    lastLogin: z.object({ mode: z.enum(["active", "inactive"]), days: z.number().int().min(1).max(365) }).optional(),
    /** İl (tenants.city), büyük/küçük harf duyarsız tam eşleşme. */
    cities: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
    /** Kapatılabilir modülün açık/kapalı olduğu ofisler. */
    module: z.object({ key: z.string().refine(isFeatureKey, "Geçersiz modül"), enabled: z.boolean() }).optional(),
    /** Yalnız ofis sahipleri (rol = owner); kapalıysa ofisin tüm aktif kullanıcıları. */
    ownersOnly: z.boolean().optional(),
    /** Doğrudan hedef: tek/birden çok ofis (diğer ölçütler yine uygulanır). */
    tenantIds: z.array(uuid).min(1).max(500).optional(),
    /** Doğrudan mesaj: tek kullanıcı (tenantIds ile birlikte, o ofiste aktif olmalı). */
    userId: uuid.optional(),
  })
  .strict();

export type Segment = z.infer<typeof segmentSchema>;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseSegment(raw: unknown): ParseResult<Segment> {
  const r = segmentSchema.safeParse(raw ?? {});
  if (!r.success) return { ok: false, error: "Hedef kitle tanımı geçersiz." };
  const v = r.data;
  if (v.userId && (!v.tenantIds || v.tenantIds.length !== 1)) return { ok: false, error: "Kullanıcıya mesaj için tek ofis seçilmeli." };
  return { ok: true, value: v };
}

/**
 * Formdaki düz alanlardan segment: seg_plan[], seg_status[], seg_trial_days, seg_login_mode + seg_login_days,
 * seg_city (virgülle), seg_module + seg_module_state, seg_owners, seg_tenant (tek ofis), seg_user (tek kullanıcı).
 */
export function segmentFromForm(fd: FormData): ParseResult<Segment> {
  const list = (k: string) => fd.getAll(k).map((v) => String(v).trim()).filter(Boolean);
  const int = (k: string) => {
    const s = String(fd.get(k) ?? "").trim();
    return /^\d{1,3}$/.test(s) ? Number(s) : undefined;
  };
  const seg: Record<string, unknown> = {};
  const plans = list("seg_plan");
  if (plans.length) seg.plans = [...new Set(plans)];
  const statuses = list("seg_status");
  if (statuses.length) seg.statuses = [...new Set(statuses)];
  const trial = int("seg_trial_days");
  if (trial !== undefined) seg.trialEndsWithinDays = trial;
  const loginMode = String(fd.get("seg_login_mode") ?? "").trim();
  const loginDays = int("seg_login_days");
  if ((loginMode === "active" || loginMode === "inactive") && loginDays) seg.lastLogin = { mode: loginMode, days: loginDays };
  const cities = String(fd.get("seg_city") ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  if (cities.length) seg.cities = [...new Set(cities)];
  const mod = String(fd.get("seg_module") ?? "").trim();
  if (mod) seg.module = { key: mod, enabled: String(fd.get("seg_module_state") ?? "on") !== "off" };
  if (fd.get("seg_owners") === "on" || fd.get("seg_owners") === "1") seg.ownersOnly = true;
  const tenant = String(fd.get("seg_tenant") ?? "").trim();
  if (tenant) seg.tenantIds = [tenant];
  const user = String(fd.get("seg_user") ?? "").trim();
  if (user) seg.userId = user;
  return parseSegment(seg);
}

export type SegmentTenant = { id: string; plan: string | null; status: string | null; trial_ends_at: string | null; city: string | null };

export type SegmentContext = {
  nowMs: number;
  /** lastLogin ölçütü varsa: son N günde başarılı girişi olan ofisler. */
  loggedInTenantIds?: ReadonlySet<string>;
  /** module ölçütü varsa: modülü KAPALI olan ofisler. */
  moduleClosedTenantIds?: ReadonlySet<string>;
};

const lower = (s: string) => s.toLocaleLowerCase("tr-TR");

/** SAF: ofis segmente uyuyor mu? (iptal edilmiş ofis hiçbir zaman uymaz.) */
export function tenantMatchesSegment(t: SegmentTenant, seg: Segment, ctx: SegmentContext): boolean {
  if (!t.status || t.status === "cancelled") return false;
  if (seg.tenantIds && !seg.tenantIds.includes(t.id)) return false;
  if (seg.plans?.length && !(seg.plans as readonly string[]).includes(t.plan ?? "")) return false;
  if (seg.statuses?.length && !(seg.statuses as readonly string[]).includes(t.status)) return false;
  if (seg.trialEndsWithinDays !== undefined) {
    if (t.status !== "trial" || !t.trial_ends_at) return false;
    const end = new Date(t.trial_ends_at).getTime();
    if (!Number.isFinite(end) || end < ctx.nowMs || end > ctx.nowMs + seg.trialEndsWithinDays * DAY_MS) return false;
  }
  if (seg.cities?.length) {
    const city = lower((t.city ?? "").trim());
    if (!city || !seg.cities.some((c) => lower(c) === city)) return false;
  }
  if (seg.lastLogin) {
    const active = ctx.loggedInTenantIds?.has(t.id) ?? false;
    if (seg.lastLogin.mode === "active" ? !active : active) return false;
  }
  if (seg.module) {
    const closed = ctx.moduleClosedTenantIds?.has(t.id) ?? false;
    if (seg.module.enabled ? closed : !closed) return false;
  }
  return true;
}

/** Arşiv ve özet için kısa Türkçe tanım ("Deneme · bitişe ≤3 gün · yalnız sahipler"). */
export function describeSegment(seg: Segment, names?: { tenant?: string | null; user?: string | null }): string {
  const parts: string[] = [];
  if (seg.userId) parts.push(`Kullanıcı: ${names?.user ?? "seçili kullanıcı"}`);
  if (seg.tenantIds?.length === 1) parts.push(`Ofis: ${names?.tenant ?? "seçili ofis"}`);
  else if (seg.tenantIds?.length) parts.push(`${seg.tenantIds.length} seçili ofis`);
  if (seg.statuses?.length) parts.push(seg.statuses.map(segmentStatusLabel).join(", "));
  if (seg.plans?.length) parts.push(`Plan: ${seg.plans.map(planLabel).join(", ")}`);
  if (seg.trialEndsWithinDays !== undefined) parts.push(`Deneme bitişine ≤${seg.trialEndsWithinDays} gün`);
  if (seg.lastLogin) parts.push(seg.lastLogin.mode === "active" ? `Son ${seg.lastLogin.days} günde giriş yapan` : `${seg.lastLogin.days} gündür giriş yapmayan`);
  if (seg.cities?.length) parts.push(`İl: ${seg.cities.join(", ")}`);
  if (seg.module && isFeatureKey(seg.module.key)) parts.push(`${getModuleDef(seg.module.key).label} ${seg.module.enabled ? "açık" : "kapalı"}`);
  if (seg.ownersOnly && !seg.userId) parts.push("yalnız sahipler");
  return parts.length ? parts.join(" · ") : "Tüm ofisler";
}

export const SEGMENT_MODULE_OPTIONS = FEATURE_KEYS.map((k) => ({ value: k, label: getModuleDef(k).label }));

// ---------------------------------------------------------------------------
// Çözümleyiciler (çağıranın service_role istemcisiyle; bu dosya istemci OLUŞTURMAZ)
// ---------------------------------------------------------------------------

/** Ofis tablosu için üst sınır: platform ölçeğinde tek turda okunur (sayfalı okuma ile). */
const TENANT_SCAN_CAP = 10_000;
const PAGE = 1000;

type Admin = {
  from: (table: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any -- PostgREST istemcisi (tablo şeması tiplenmemiş)
  rpc: (fn: string, args: Record<string, unknown>) => any; // eslint-disable-line @typescript-eslint/no-explicit-any -- PostgREST RPC oluşturucusu (order/range)
};

async function pagedIds(fetchPage: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>, pick: (r: Record<string, unknown>) => string) {
  const out = new Set<string>();
  for (let from = 0; from < TENANT_SCAN_CAP; from += PAGE) {
    const { data, error } = await fetchPage(from, from + PAGE - 1);
    if (error) throw new Error("Hedef kitle okunamadı.");
    for (const r of (data ?? []) as Record<string, unknown>[]) out.add(pick(r));
    if (!data || data.length < PAGE) return out;
  }
  // Sessizce kesmek yanlış hedef kitle demektir (ör. "giriş yapmayan" ölçütüne aktif ofisler girer): hata ver.
  throw new ActionUserError("Hedef kitle çok büyük; ölçütü daraltın.");
}

/** Segmentteki ofis kimlikleri (iptal hariç). */
export async function resolveSegmentTenantIds(admin: Admin, seg: Segment, nowMs: number): Promise<string[]> {
  const tenants: SegmentTenant[] = [];
  for (let from = 0; from < TENANT_SCAN_CAP; from += PAGE) {
    let q = admin.from("tenants").select("id, plan, status, trial_ends_at, city").neq("status", "cancelled");
    if (seg.tenantIds) q = q.in("id", seg.tenantIds);
    if (seg.statuses?.length) q = q.in("status", seg.statuses);
    if (seg.plans?.length) q = q.in("plan", seg.plans);
    const { data, error } = await q.order("id").range(from, from + PAGE - 1);
    if (error) throw new Error("Hedef ofisler okunamadı.");
    tenants.push(...((data ?? []) as SegmentTenant[]));
    if (!data || data.length < PAGE) break;
  }
  const ids = tenants.map((t) => t.id);
  const ctx: SegmentContext = { nowMs };
  if (seg.lastLogin && ids.length) {
    const since = new Date(nowMs - seg.lastLogin.days * DAY_MS).toISOString();
    // Ofis başına tek satır (RPC: ofis başına EXISTS, giriş satırı sayısından bağımsız); ham giriş satırı taranmaz.
    ctx.loggedInTenantIds = await pagedIds(
      (a, b) => admin.rpc("platform_announcement_login_tenants", { p_since: since }).order("tenant_id").range(a, b),
      (r) => r.tenant_id as string,
    );
  }
  if (seg.module && ids.length) {
    ctx.moduleClosedTenantIds = await pagedIds(
      (a, b) => admin.from("tenant_modules").select("tenant_id").eq("module_key", seg.module!.key).eq("enabled", false).order("tenant_id").range(a, b),
      (r) => r.tenant_id as string,
    );
  }
  return tenants.filter((t) => tenantMatchesSegment(t, seg, ctx)).map((t) => t.id);
}

export type SegmentRecipient = { tenantId: string; userId: string; marketingOptIn: boolean };

/** Ofislerdeki alıcı kullanıcılar (aktif; ownersOnly ise yalnız sahip; userId ise yalnız o kişi). */
export async function resolveSegmentRecipients(admin: Admin, seg: Segment, tenantIds: string[]): Promise<SegmentRecipient[]> {
  const out: SegmentRecipient[] = [];
  for (let i = 0; i < tenantIds.length; i += 200) {
    const chunk = tenantIds.slice(i, i + 200);
    for (let from = 0; ; from += PAGE) {
      let q = admin.from("profiles").select("id, tenant_id, notification_prefs").in("tenant_id", chunk).eq("is_active", true);
      if (seg.userId) q = q.eq("id", seg.userId);
      else if (seg.ownersOnly) q = q.eq("role", "owner");
      const { data, error } = await q.order("id").range(from, from + PAGE - 1);
      if (error) throw new Error("Alıcılar okunamadı.");
      for (const p of (data ?? []) as { id: string; tenant_id: string; notification_prefs: Record<string, unknown> | null }[]) {
        out.push({ tenantId: p.tenant_id, userId: p.id, marketingOptIn: p.notification_prefs?.marketing === true });
      }
      if (!data || data.length < PAGE) break;
    }
  }
  return out;
}
