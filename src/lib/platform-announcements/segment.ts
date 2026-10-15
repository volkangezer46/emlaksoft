import { z } from "zod";
import { DAY_MS } from "@/lib/clock";
import { planLabel } from "@/lib/billing/plans";
import { FEATURE_KEYS, getModuleDef, isFeatureKey } from "@/lib/modules/registry";
import { ActionUserError } from "@/lib/action-errors";
import { HEALTH_BAND_LABELS, HEALTH_DEFAULT_RISK_THRESHOLD, healthBand, type HealthBand } from "@/lib/admin/health-score";
import { LIFECYCLE_LABELS, LIFECYCLE_STAGES, effectiveStage } from "@/lib/admin/platform-crm";

/**
 * Duyuru SEGMENTİ (AD8): hangi ofislerin hangi kullanıcılarına gidileceği. Tek kaynak: kuyruk (gönderim anında çözer),
 * banner (kayıt anında çözer), canlı sayım önizlemesi ve arşivdeki "Hedef" etiketi bu dosyayı kullanır.
 *
 * Ölçütler VE ile birleşir. Boş ölçüt = kısıt yok. İptal edilmiş ofis HER ZAMAN dışarıda (eski "tüm ofisler" kuralı).
 * Ofis CRM ölçütleri (PA-11): etiket, sağlık bandı, yaşam döngüsü aşaması, sorumlu personel ve kayıt yaşı. Bir ölçüt
 * İÇİNDE seçenekler VEYA ile (ör. "Kurumsal" ya da "VIP" etiketli), ölçütler arası VE ile birleşir. Skoru hesaplanmamış
 * ofis hiçbir sağlık bandına girmez; aşama elle seçilmediyse ofis durumundan türetilir (liste ile aynı kural).
 *
 * Bu dosya service_role istemcisi OLUŞTURMAZ; çözümleyiciler çağıranın istemcisini alır.
 */

export const SEGMENT_STATUSES = ["trial", "active", "past_due", "suspended"] as const;
export const SEGMENT_PLANS = ["advisor", "office", "professional", "business", "enterprise"] as const;
export const SEGMENT_HEALTH_BANDS = ["riskli", "izlenmeli", "saglikli"] as const satisfies readonly HealthBand[];
/** Sorumlu ölçütünde "atanmamış" seçeneği. */
export const SEGMENT_OWNER_NONE = "yok" as const;

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
    /** Ofis etiketi (AD5 tenant_tag_links): seçilenlerden EN AZ BİRİ. */
    tagIds: z.array(uuid).min(1).max(20).optional(),
    /** Sağlık bandı (riskli eşiği ayar defterinden; skorsuz ofis dışarıda). */
    healthBands: z.array(z.enum(SEGMENT_HEALTH_BANDS)).min(1).max(3).optional(),
    /** Yaşam döngüsü aşaması (elle seçilen ya da durumdan türeyen). */
    lifecycleStages: z.array(z.enum(LIFECYCLE_STAGES)).min(1).max(LIFECYCLE_STAGES.length).optional(),
    /** Sorumlu personel (kimlik) ya da "yok" (atanmamış). */
    accountOwners: z.array(z.union([uuid, z.literal(SEGMENT_OWNER_NONE)])).min(1).max(20).optional(),
    /** Son N günde kayıt olan ofisler. */
    signedUpWithinDays: z.number().int().min(1).max(365).optional(),
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
  const tags = list("seg_tag");
  if (tags.length) seg.tagIds = [...new Set(tags.map((t) => t.toLowerCase()))];
  const bands = list("seg_health");
  if (bands.length) seg.healthBands = [...new Set(bands)];
  const stages = list("seg_stage");
  if (stages.length) seg.lifecycleStages = [...new Set(stages)];
  const owners = list("seg_owner");
  if (owners.length) seg.accountOwners = [...new Set(owners.map((o) => o.toLowerCase()))];
  const signup = int("seg_signup_days");
  if (signup !== undefined) seg.signedUpWithinDays = signup;
  return parseSegment(seg);
}

export type SegmentTenant = { id: string; plan: string | null; status: string | null; trial_ends_at: string | null; city: string | null; created_at?: string | null };

/** Ofis CRM satırı (segment değerlendirmesi için). */
export type SegmentCrm = { score: number | null; stage: string | null; ownerId: string | null };

export type SegmentContext = {
  nowMs: number;
  /** lastLogin ölçütü varsa: son N günde başarılı girişi olan ofisler. */
  loggedInTenantIds?: ReadonlySet<string>;
  /** module ölçütü varsa: modülü KAPALI olan ofisler. */
  moduleClosedTenantIds?: ReadonlySet<string>;
  /** CRM ölçütleri varsa: ofis → sorumlu/aşama/skor (satırı olmayan ofis = boş CRM). */
  crm?: ReadonlyMap<string, SegmentCrm>;
  /** tagIds ölçütü varsa: seçili etiketlerden en az birini taşıyan ofisler. */
  taggedTenantIds?: ReadonlySet<string>;
  /** Sağlık bandı eşiği (crm.health_risk_threshold); yoksa varsayılan. */
  riskThreshold?: number;
};

/** Segment CRM satırı gerektiriyor mu (sağlık, aşama, sorumlu)? */
export function segmentNeedsCrm(seg: Segment): boolean {
  return Boolean(seg.healthBands?.length || seg.lifecycleStages?.length || seg.accountOwners?.length);
}

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
  if (seg.signedUpWithinDays !== undefined) {
    const created = t.created_at ? new Date(t.created_at).getTime() : NaN;
    if (!Number.isFinite(created) || created < ctx.nowMs - seg.signedUpWithinDays * DAY_MS) return false;
  }
  if (seg.tagIds?.length && !(ctx.taggedTenantIds?.has(t.id) ?? false)) return false;
  if (segmentNeedsCrm(seg)) {
    const c = ctx.crm?.get(t.id) ?? { score: null, stage: null, ownerId: null };
    if (seg.healthBands?.length) {
      if (c.score == null) return false;
      if (!(seg.healthBands as readonly string[]).includes(healthBand(c.score, ctx.riskThreshold ?? HEALTH_DEFAULT_RISK_THRESHOLD))) return false;
    }
    if (seg.lifecycleStages?.length && !(seg.lifecycleStages as readonly string[]).includes(effectiveStage(c.stage, t.status).stage)) return false;
    if (seg.accountOwners?.length) {
      const key = c.ownerId ?? SEGMENT_OWNER_NONE;
      if (!seg.accountOwners.includes(key)) return false;
    }
  }
  return true;
}

/** Arşiv ve özet için kısa Türkçe tanım ("Deneme · bitişe ≤3 gün · yalnız sahipler"). */
export function describeSegment(
  seg: Segment,
  names?: { tenant?: string | null; user?: string | null; tag?: (id: string) => string | null | undefined; staff?: (id: string) => string | null | undefined },
): string {
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
  if (seg.tagIds?.length) {
    const tagNames = seg.tagIds.map((id) => names?.tag?.(id)).filter((n): n is string => Boolean(n));
    parts.push(tagNames.length === seg.tagIds.length ? `Etiket: ${tagNames.join(" ya da ")}` : `${seg.tagIds.length} etiketten biri`);
  }
  if (seg.healthBands?.length) parts.push(`Sağlık: ${seg.healthBands.map((b) => HEALTH_BAND_LABELS[b]).join(", ")}`);
  if (seg.lifecycleStages?.length) parts.push(`Aşama: ${seg.lifecycleStages.map((s) => LIFECYCLE_LABELS[s]).join(", ")}`);
  if (seg.accountOwners?.length) {
    const who = seg.accountOwners.map((o) => (o === SEGMENT_OWNER_NONE ? "atanmamış" : (names?.staff?.(o) ?? "seçili personel")));
    parts.push(`Sorumlu: ${who.join(", ")}`);
  }
  if (seg.signedUpWithinDays !== undefined) parts.push(`Son ${seg.signedUpWithinDays} günde kayıt`);
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
    let q = admin.from("tenants").select("id, plan, status, trial_ends_at, city, created_at").neq("status", "cancelled");
    if (seg.tenantIds) q = q.in("id", seg.tenantIds);
    if (seg.signedUpWithinDays !== undefined) q = q.gte("created_at", new Date(nowMs - seg.signedUpWithinDays * DAY_MS).toISOString());
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
  if (seg.tagIds?.length && ids.length) {
    ctx.taggedTenantIds = await pagedIds(
      (a, b) => admin.from("tenant_tag_links").select("tenant_id").in("tag_id", seg.tagIds!).order("tenant_id").order("tag_id").range(a, b),
      (r) => r.tenant_id as string,
    );
  }
  if (segmentNeedsCrm(seg) && ids.length) {
    const crm = new Map<string, SegmentCrm>();
    for (let i = 0; i < ids.length; i += 500) {
      const { data, error } = await admin.from("platform_tenant_crm").select("tenant_id, account_owner_staff_id, lifecycle_stage, health_score").in("tenant_id", ids.slice(i, i + 500));
      if (error) throw new ActionUserError("Ofis CRM ölçütleri okunamadı (CRM kurulumu bekliyor olabilir).");
      for (const r of (data ?? []) as { tenant_id: string; account_owner_staff_id: string | null; lifecycle_stage: string | null; health_score: number | null }[]) {
        crm.set(r.tenant_id, { score: r.health_score, stage: r.lifecycle_stage, ownerId: r.account_owner_staff_id });
      }
    }
    ctx.crm = crm;
    if (seg.healthBands?.length) ctx.riskThreshold = await readRiskThreshold();
  }
  return tenants.filter((t) => tenantMatchesSegment(t, seg, ctx)).map((t) => t.id);
}

/** Sağlık bandı eşiği: ayar defteri (sunucu) — okunamazsa varsayılan. Dinamik içe aktarma: saf testler ayar okumaz. */
async function readRiskThreshold(): Promise<number> {
  try {
    const [{ getSetting }, { CRM_SETTING_KEYS }] = await Promise.all([import("@/lib/settings/read"), import("@/lib/settings/registry/crm")]);
    const v = Number(await getSetting<number>(CRM_SETTING_KEYS.riskThreshold));
    return Number.isFinite(v) && v > 0 ? v : HEALTH_DEFAULT_RISK_THRESHOLD;
  } catch {
    return HEALTH_DEFAULT_RISK_THRESHOLD;
  }
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
