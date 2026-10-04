import { createAdminClient } from "@/lib/supabase/admin";
import { orIlike, safeLike } from "@/lib/pgrst";
import { daysAgoIso, parseTrLocalDateTime } from "@/lib/clock";

/**
 * Aktivite / denetim izi sunucu sorgusu — sayfa (`/admin/aktivite`) ve CSV dışa aktarma
 * (`exportActivityCsv`) AYNI süzgeci kullanır: ekranda görünen ile indirilen aynı kayıtlardır.
 * Yalnız sunucuda çağrılır (service role); çağıran `requirePlatformModule("activity")` ile kapılar.
 */
export type ActivityFilters = {
  kaynak?: "platform" | "tenant";
  gun?: "bugun";
  /** İşlem türü (eylem adı parçası: "platform_staff", "ops.impersonate"). */
  islem?: string;
  /** İşlemi yapan kişi (ad parçası). */
  kisi?: string;
  /** Ofis adı parçası (yalnız ofis kayıtları). */
  ofis?: string;
  /** Serbest arama: eylem veya varlık türü. */
  q?: string;
  /** YYYY-MM-DD (Türkiye günü, dahil). */
  baslangic?: string;
  bitis?: string;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const clip = (v: string | undefined, n = 80) => (v ?? "").trim().slice(0, n) || undefined;

export function parseActivityFilters(sp: Record<string, string | undefined>): ActivityFilters {
  return {
    kaynak: sp.kaynak === "platform" || sp.kaynak === "tenant" ? sp.kaynak : undefined,
    gun: sp.gun === "bugun" ? "bugun" : undefined,
    islem: clip(sp.islem),
    kisi: clip(sp.kisi),
    ofis: clip(sp.ofis),
    q: clip(sp.q),
    baslangic: DATE_RE.test(sp.baslangic ?? "") ? sp.baslangic : undefined,
    bitis: DATE_RE.test(sp.bitis ?? "") ? sp.bitis : undefined,
  };
}

export function hasActivityFilter(f: ActivityFilters): boolean {
  return Object.values(f).some(Boolean);
}

export function activityHref(f: ActivityFilters, extra: { sayfa?: number } = {}): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v) sp.set(k, v);
  if (extra.sayfa && extra.sayfa > 1) sp.set("sayfa", String(extra.sayfa));
  const s = sp.toString();
  return s ? `/admin/aktivite?${s}` : "/admin/aktivite";
}

export type ActivityTenantRow = {
  id: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  actor_id: string | null;
  tenant_id: string | null;
  old_value: unknown;
  new_value: unknown;
  created_at: string;
  tenant: { name: string } | { name: string }[] | null;
};

export type ActivityPlatformRow = {
  id: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  actor_id: string | null;
  meta: unknown;
  created_at: string;
};

export type ActivityResult = {
  tenantRows: ActivityTenantRow[];
  platformRows: ActivityPlatformRow[];
  tenantCount: number;
  platformCount: number;
  includeTenant: boolean;
  includePlatform: boolean;
};

/** Ad parçasından kullanıcı kimlikleri (platform personeli + ofis kullanıcıları). */
async function actorIdsByName(admin: ReturnType<typeof createAdminClient>, name: string) {
  const like = safeLike(name);
  const [{ data: staff }, { data: profiles }] = await Promise.all([
    admin.from("platform_staff").select("id").ilike("full_name", like).limit(100),
    admin.from("profiles").select("id").ilike("full_name", like).limit(200),
  ]);
  return {
    platform: (staff ?? []).map((r) => r.id as string),
    tenant: (profiles ?? []).map((r) => r.id as string),
  };
}

/**
 * İki kaynaktan (audit_logs + platform_audit_logs) ilk `fetchEnd + 1` kaydı çeker.
 * Birleşik listenin ilk N kaydı her zaman iki kaynağın ilk N kaydının içindedir; çağıran birleştirip dilimler.
 */
export async function queryActivity(f: ActivityFilters, fetchEnd: number): Promise<ActivityResult> {
  const admin = createAdminClient();

  const startIso = f.baslangic ? parseTrLocalDateTime(`${f.baslangic}T00:00`)?.toISOString() : undefined;
  const endIso = f.bitis ? parseTrLocalDateTime(`${f.bitis}T23:59:59`)?.toISOString() : undefined;
  const daySince = f.gun ? daysAgoIso(1) : undefined;

  // Ofis adı → kimlikler (yalnız ofis kayıtları ilgilenir)
  let tenantIds: string[] | null = null;
  if (f.ofis) {
    const { data } = await admin.from("tenants").select("id").ilike("name", safeLike(f.ofis)).limit(200);
    tenantIds = (data ?? []).map((r) => r.id as string);
  }
  // Kişi adı → kimlikler
  let actors: { platform: string[]; tenant: string[] } | null = null;
  if (f.kisi) actors = await actorIdsByName(admin, f.kisi);

  const includeTenant = f.kaynak !== "platform";
  const includePlatform = f.kaynak !== "tenant" && !f.ofis;

  const empty = { data: [] as never[], count: 0 };

  const tenantSkip = !includeTenant || (tenantIds !== null && tenantIds.length === 0) || (actors !== null && actors.tenant.length === 0);
  const platformSkip = !includePlatform || (actors !== null && actors.platform.length === 0);

  let tenantQ = admin
    .from("audit_logs")
    .select(
      "id, action, entity_type, entity_id, actor_id, tenant_id, old_value, new_value, created_at, tenant:tenants(name)",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(0, fetchEnd);
  let platformQ = admin
    .from("platform_audit_logs")
    .select("id, action, entity_type, entity_id, actor_id, meta, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(0, fetchEnd);

  if (daySince) {
    tenantQ = tenantQ.gte("created_at", daySince);
    platformQ = platformQ.gte("created_at", daySince);
  }
  if (startIso) {
    tenantQ = tenantQ.gte("created_at", startIso);
    platformQ = platformQ.gte("created_at", startIso);
  }
  if (endIso) {
    tenantQ = tenantQ.lte("created_at", endIso);
    platformQ = platformQ.lte("created_at", endIso);
  }
  if (f.islem) {
    tenantQ = tenantQ.ilike("action", safeLike(f.islem));
    platformQ = platformQ.ilike("action", safeLike(f.islem));
  }
  if (f.q) {
    const or = orIlike(["action", "entity_type"], f.q);
    tenantQ = tenantQ.or(or);
    platformQ = platformQ.or(or);
  }
  if (tenantIds) tenantQ = tenantQ.in("tenant_id", tenantIds.length ? tenantIds : ["00000000-0000-0000-0000-000000000000"]);
  if (actors) {
    tenantQ = tenantQ.in("actor_id", actors.tenant.length ? actors.tenant : ["00000000-0000-0000-0000-000000000000"]);
    platformQ = platformQ.in("actor_id", actors.platform.length ? actors.platform : ["00000000-0000-0000-0000-000000000000"]);
  }

  const [tenantRes, platformRes] = await Promise.all([
    tenantSkip ? Promise.resolve(empty) : tenantQ,
    platformSkip ? Promise.resolve(empty) : platformQ,
  ]);

  return {
    tenantRows: (tenantRes.data ?? []) as unknown as ActivityTenantRow[],
    platformRows: (platformRes.data ?? []) as unknown as ActivityPlatformRow[],
    tenantCount: tenantRes.count ?? 0,
    platformCount: platformRes.count ?? 0,
    includeTenant: !tenantSkip,
    includePlatform: !platformSkip,
  };
}

/** Aktörlerin görünen adları (platform personeli + ofis kullanıcıları). */
export async function resolveActorNames(platformIds: string[], tenantIds: string[]) {
  const admin = createAdminClient();
  const [{ data: staffList }, { data: profiles }] = await Promise.all([
    platformIds.length
      ? admin.from("platform_staff").select("id, full_name").in("id", platformIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    tenantIds.length
      ? admin.from("profiles").select("id, full_name").in("id", tenantIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
  ]);
  const platform = new Map<string, string>();
  for (const s of staffList ?? []) platform.set(s.id, s.full_name);
  const tenant = new Map<string, string>();
  for (const p of profiles ?? []) tenant.set(p.id, p.full_name);
  return { platform, tenant };
}
