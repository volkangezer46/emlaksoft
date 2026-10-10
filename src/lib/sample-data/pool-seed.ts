import type { SupabaseClient } from "@supabase/supabase-js";
import { now, trDayKey } from "@/lib/clock";
import {
  rankCandidates,
  toStoredSuggestions,
  type PoolCandidate,
  type PoolProperty,
  type RegionRow,
  type SpecialtyRow,
} from "@/lib/pool/score";

/**
 * Ilan havuzu + danisman uzmanlik/bolge ORNEK verisi (demo-ofis ve "Demo veriyle basla" icin TEK kaynak).
 *
 * KURAL (HAFIZA §3): demo danisman HESABI acilmaz (profiles.id auth.users'a bagli). Bu yuzden uzmanlik/bolge satirlari
 * cagiranin verdigi MEVCUT profillere (kurucu; demo-ofiste ayrica GM ve demo danismani) sablonlar halinde dagitilir.
 * Tek profil varsa hepsi ona birlesir (ayni anahtar iki kez yazilmaz).
 *
 * Isaretleme: advisor_specialties/advisor_regions.is_sample (20261010000800) ve ornek portfoyler `is_sample`; havuz kayitlari
 * portfoye bagli oldugu icin portfoyle birlikte silinir. `purge-extras.ts` hepsini acikca temizler. IDEMPOTENT: ilk ornek
 * havuz portfoyunun kodu varsa hicbir sey yazmaz.
 */

type Dict = Record<string, unknown>;

export type PoolSeedContext = {
  db: SupabaseClient;
  tenantId: string;
  ownerId: string;
  advisorId: string;
  sample: boolean;
  place: { provinceId: string | null; districtId: string | null; districts: Record<string, string | null> };
  codePrefix: string;
  /** Uzmanlik/bolge yazilacak profiller (yoksa advisorId). */
  poolProfileIds?: string[];
};

type SpecTemplate = Omit<SpecialtyRow, "level"> & { level: number };
type Template = { specialties: SpecTemplate[]; regions: { district: string; weight: number }[] };

const spec = (kind: "property_type" | "segment", value: string, transactionType: string | null, level: number, priceMin: number | null = null, priceMax: number | null = null): SpecTemplate => ({
  kind,
  value,
  transactionType,
  level,
  priceMin,
  priceMax,
});

/** Danisman sablonlari (Istanbul): konut, luks konut, arsa, ticari. */
export const POOL_TEMPLATES: readonly Template[] = [
  {
    specialties: [spec("property_type", "Daire", "Satılık", 3, 3_000_000, 15_000_000), spec("property_type", "Daire", "Kiralık", 2, 20_000, 80_000)],
    regions: [{ district: "Kadıköy", weight: 5 }, { district: "Ataşehir", weight: 3 }],
  },
  {
    specialties: [spec("property_type", "Villa", "Satılık", 3, 15_000_000, null), spec("segment", "Lüks konut", "Satılık", 3, 15_000_000, null)],
    regions: [{ district: "Beşiktaş", weight: 5 }, { district: "Şişli", weight: 3 }],
  },
  {
    specialties: [spec("property_type", "Arsa", "Satılık", 3), spec("segment", "Yatırımlık", "Satılık", 2)],
    regions: [{ district: "Ataşehir", weight: 5 }, { district: "Kadıköy", weight: 2 }],
  },
  {
    specialties: [spec("property_type", "Dükkan", null, 2), spec("property_type", "Ofis", "Kiralık", 2)],
    regions: [{ district: "Şişli", weight: 4 }, { district: "Beşiktaş", weight: 2 }],
  },
];

export type PoolPropertyDef = {
  suffix: string;
  title: string;
  district: string;
  type: string;
  transaction: "Satılık" | "Kiralık";
  price: number;
  rooms: string | null;
  sqm: number;
  source: "manual" | "import" | "portal_form" | "network" | "api" | "extension";
  /** null = havuzda bekliyor; sayi = atanmis gecmis kayit (profil sirasi). */
  assignedSlot: number | null;
  method?: "suggested" | "auto";
  daysAgo: number;
};

export const POOL_PROPERTY_DEFS: readonly PoolPropertyDef[] = [
  { suffix: "H01", title: "Kadıköy Fenerbahçe'de 3+1 satılık daire", district: "Kadıköy", type: "Daire", transaction: "Satılık", price: 9_200_000, rooms: "3+1", sqm: 135, source: "portal_form", assignedSlot: null, daysAgo: 0 },
  { suffix: "H02", title: "Beşiktaş Bebek'te deniz manzaralı villa", district: "Beşiktaş", type: "Villa", transaction: "Satılık", price: 48_000_000, rooms: "6+2", sqm: 420, source: "network", assignedSlot: null, daysAgo: 1 },
  { suffix: "H03", title: "Ataşehir'de imarlı satılık arsa", district: "Ataşehir", type: "Arsa", transaction: "Satılık", price: 18_500_000, rooms: null, sqm: 900, source: "api", assignedSlot: null, daysAgo: 1 },
  { suffix: "H04", title: "Şişli Mecidiyeköy'de kiralık dükkan", district: "Şişli", type: "Dükkan", transaction: "Kiralık", price: 95_000, rooms: null, sqm: 110, source: "extension", assignedSlot: null, daysAgo: 2 },
  { suffix: "H05", title: "Kadıköy Moda'da 2+1 kiralık daire", district: "Kadıköy", type: "Daire", transaction: "Kiralık", price: 42_000, rooms: "2+1", sqm: 95, source: "manual", assignedSlot: null, daysAgo: 3 },
  { suffix: "H06", title: "Ataşehir Barbaros'ta 4+1 satılık daire", district: "Ataşehir", type: "Daire", transaction: "Satılık", price: 14_000_000, rooms: "4+1", sqm: 190, source: "import", assignedSlot: 0, method: "suggested", daysAgo: 9 },
  { suffix: "H07", title: "Beşiktaş Levent'te 2+1 kiralık daire", district: "Beşiktaş", type: "Daire", transaction: "Kiralık", price: 65_000, rooms: "2+1", sqm: 100, source: "portal_form", assignedSlot: 1, method: "auto", daysAgo: 14 },
];

const addDays = (key: string, n: number): string => {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const isoAt = (key: string, hour: number): string => new Date(Math.min(now(), Date.parse(`${key}T${String(hour).padStart(2, "0")}:00:00+03:00`))).toISOString();

function fail(label: string, e: { message?: string; code?: string }): never {
  const err = new Error(`${label}: ${e.message ?? "hata"}`) as Error & { code?: string };
  err.code = e.code;
  throw err;
}

/** Sablonlari profillere dagitir ve (profil, anahtar) cakismalarini birlestirir. */
export function planAdvisorProfiles(profileIds: readonly string[], districts: Record<string, string | null>, provinceId: string | null) {
  const specs = new Map<string, Dict & { profile_id: string }>();
  const regions = new Map<string, Dict & { profile_id: string }>();
  POOL_TEMPLATES.forEach((t, i) => {
    const profileId = profileIds[i % profileIds.length]!;
    for (const s of t.specialties) {
      const key = `${profileId}|${s.kind}|${s.value}|${s.transactionType ?? ""}`;
      if (specs.has(key)) continue;
      specs.set(key, { profile_id: profileId, kind: s.kind, value: s.value, transaction_type: s.transactionType, price_min: s.priceMin, price_max: s.priceMax, level: s.level });
    }
    for (const r of t.regions) {
      const districtId = districts[r.district];
      if (!provinceId || !districtId) continue;
      const key = `${profileId}|${districtId}`;
      const prev = regions.get(key);
      if (prev && Number(prev.weight) >= r.weight) continue;
      regions.set(key, { profile_id: profileId, province_id: provinceId, district_id: districtId, weight: r.weight });
    }
  });
  return { specialties: [...specs.values()], regions: [...regions.values()] };
}

export async function seedListingPool(ctx: PoolSeedContext): Promise<number> {
  const { db, tenantId } = ctx;
  const first = `${ctx.codePrefix}-${POOL_PROPERTY_DEFS[0]!.suffix}`;
  const existing = await db.from("properties").select("id").eq("tenant_id", tenantId).eq("property_code", first).limit(1);
  if (existing.error) fail("properties", existing.error);
  if ((existing.data ?? []).length > 0) return 0;

  const profileIds = [...new Set(ctx.poolProfileIds?.length ? ctx.poolProfileIds : [ctx.advisorId])];
  const sampleFlag = ctx.sample ? { is_sample: true } : {};
  const plan = planAdvisorProfiles(profileIds, ctx.place.districts, ctx.place.provinceId);

  // 1) Uzmanlik + bolge (anahtar zaten varsa — gercek veri — dokunulmaz).
  // Benzersiz dizinler ifade (coalesce) içerdiği için upsert yerine önce var olanlar okunur, yalnız eksikler yazılır.
  const [haveSpecs, haveRegions] = await Promise.all([
    db.from("advisor_specialties").select("profile_id, kind, value, transaction_type").eq("tenant_id", tenantId).in("profile_id", profileIds),
    db.from("advisor_regions").select("profile_id, district_id").eq("tenant_id", tenantId).in("profile_id", profileIds).is("neighborhood_id", null),
  ]);
  if (haveSpecs.error) fail("advisor_specialties", haveSpecs.error);
  if (haveRegions.error) fail("advisor_regions", haveRegions.error);
  const specKeys = new Set((haveSpecs.data ?? []).map((r) => `${r.profile_id}|${r.kind}|${r.value}|${r.transaction_type ?? ""}`));
  const regionKeys = new Set((haveRegions.data ?? []).map((r) => `${r.profile_id}|${r.district_id}`));
  const newSpecs = plan.specialties.filter((r) => !specKeys.has(`${r.profile_id}|${r.kind}|${r.value}|${r.transaction_type ?? ""}`));
  const newRegions = plan.regions.filter((r) => !regionKeys.has(`${r.profile_id}|${r.district_id}`));
  if (newSpecs.length) {
    const { error } = await db.from("advisor_specialties").insert(newSpecs.map((r) => ({ ...r, tenant_id: tenantId, is_sample: true })));
    if (error) fail("advisor_specialties", error);
  }
  if (newRegions.length) {
    const { error } = await db.from("advisor_regions").insert(newRegions.map((r) => ({ ...r, tenant_id: tenantId, is_sample: true })));
    if (error) fail("advisor_regions", error);
  }

  // 2) Ornek ilanlar.
  const today = trDayKey(now());
  const districtOf = (name: string) => ctx.place.districts[name] ?? ctx.place.districtId;
  const props = await db
    .from("properties")
    .insert(
      POOL_PROPERTY_DEFS.map((d) => {
        const assignee = d.assignedSlot == null ? null : profileIds[d.assignedSlot % profileIds.length]!;
        return {
          tenant_id: tenantId,
          property_code: `${ctx.codePrefix}-${d.suffix}`,
          title: d.title,
          transaction_type: d.transaction,
          property_type: d.type,
          status: assignee ? "live" : "draft",
          published_at: assignee ? isoAt(addDays(today, -d.daysAgo), 12) : null,
          list_price: d.price,
          commission_rate: d.transaction === "Satılık" ? 2 : 10,
          province_id: ctx.place.provinceId,
          district_id: districtOf(d.district),
          address_line: `${d.district}, İstanbul`,
          features: d.rooms ? { rooms: d.rooms, sqm: d.sqm, net_sqm: Math.round(d.sqm * 0.88) } : { sqm: d.sqm },
          assigned_to: assignee,
          created_by: ctx.ownerId,
          created_at: isoAt(addDays(today, -d.daysAgo), 10),
          ...sampleFlag,
        };
      }),
    )
    .select("id, property_code");
  if (props.error) fail("properties", props.error);
  const idOf = new Map((props.data ?? []).map((p) => [String(p.property_code), String(p.id)]));

  // 3) Havuz kayitlari: oneriler gercek puanlama motoruyla uretilir (ayni uzmanlik/bolge sablonlarindan).
  const nowMs = now();
  const candidates: PoolCandidate[] = profileIds.map((id) => {
    const mine = {
      specialties: plan.specialties.filter((s) => s.profile_id === id).map((s): SpecialtyRow => ({
        kind: s.kind as "property_type" | "segment",
        value: String(s.value),
        transactionType: (s.transaction_type as string | null) ?? null,
        priceMin: (s.price_min as number | null) ?? null,
        priceMax: (s.price_max as number | null) ?? null,
        level: Number(s.level),
      })),
      regions: plan.regions.filter((r) => r.profile_id === id).map((r): RegionRow => ({ provinceId: String(r.province_id), districtId: String(r.district_id), neighborhoodId: null, weight: Number(r.weight) })),
    };
    return {
      profileId: id,
      name: "Danışman",
      isActive: true,
      acceptsPool: true,
      pausedUntilMs: null,
      onLeave: false,
      ruleUnavailable: false,
      licenseExpired: false,
      openListings: 3,
      capacity: null,
      specialties: mine.specialties,
      regions: mine.regions,
      performance: null,
      availability: "in_hours",
      lastAssignedAtMs: null,
      ruleWeight: 1,
    };
  });

  const entries = POOL_PROPERTY_DEFS.map((d) => {
    const property: PoolProperty = {
      propertyType: d.type,
      transactionType: d.transaction,
      provinceId: ctx.place.provinceId,
      districtId: districtOf(d.district),
      neighborhoodId: null,
      listPrice: d.price,
    };
    const ranked = rankCandidates(candidates, property, { nowMs, officeAvgOpen: 3, labels: { district: d.district, province: "İstanbul" } });
    const top = ranked.find((s) => !s.excluded) ?? null;
    const at = isoAt(addDays(today, -d.daysAgo), 10);
    const assignee = d.assignedSlot == null ? null : profileIds[d.assignedSlot % profileIds.length]!;
    return {
      def: d,
      assignee,
      at,
      top,
      row: {
        tenant_id: tenantId,
        property_id: idOf.get(`${ctx.codePrefix}-${d.suffix}`)!,
        source: d.source,
        status: assignee ? "assigned" : "pending",
        suggestions: toStoredSuggestions(ranked),
        top_score: top ? top.score : null,
        suggested_at: at,
        assigned_to: assignee,
        assigned_by: assignee ? ctx.ownerId : null,
        assigned_at: assignee ? isoAt(addDays(today, -d.daysAgo), 14) : null,
        assign_method: assignee ? d.method : null,
        reason: assignee ? (top?.summary ?? "Ofis sahibi atadı.") : null,
        created_by: ctx.ownerId,
        created_at: at,
      },
    };
  });
  const created = await db.from("listing_pool_entries").insert(entries.map((e) => e.row)).select("id, property_id");
  if (created.error) fail("listing_pool_entries", created.error);
  const entryOf = new Map((created.data ?? []).map((r) => [String(r.property_id), String(r.id)]));

  const events: Dict[] = [];
  for (const e of entries) {
    const entryId = entryOf.get(String(e.row.property_id));
    if (!entryId) continue;
    events.push({ tenant_id: tenantId, entry_id: entryId, event: "created", actor_id: ctx.ownerId, detail: { source: e.def.source }, created_at: e.at });
    events.push({ tenant_id: tenantId, entry_id: entryId, event: "suggested", score: e.top ? e.top.score : null, to_profile_id: e.top ? e.top.profileId : null, detail: {}, created_at: e.at });
    if (e.assignee) {
      events.push({
        tenant_id: tenantId,
        entry_id: entryId,
        event: "assigned",
        actor_id: ctx.ownerId,
        to_profile_id: e.assignee,
        score: e.top ? e.top.score : null,
        reason: e.row.reason,
        detail: { method: e.def.method },
        created_at: e.row.assigned_at,
      });
    }
  }
  const ev = await db.from("listing_pool_events").insert(events);
  if (ev.error) fail("listing_pool_events", ev.error);

  // Demo-ofiste havuz acik olsun (yeni kayitli ofislerde varsayilan zaten acik; mevcut ofis ayarina dokunulmaz).
  if (!ctx.sample) await db.from("tenants").update({ listing_pool_enabled: true }).eq("id", tenantId);
  return entries.length;
}
