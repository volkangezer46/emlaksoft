import { isLifecycleStage, LIFECYCLE_LABELS, type LifecycleStage } from "@/lib/admin/platform-crm";
import { HEALTH_BAND_LABELS, type HealthBand } from "@/lib/admin/health-score";

/**
 * /admin/tenants saf modeli (DOM/zaman yok; vitest): filtre kontratı (URL ↔ sunucu sorgusu), href üretimi,
 * envanter sayımları (KPI + grafikler), etkinlik rozeti. Zaman eşikleri çağırandan ISO olarak gelir (clock.ts).
 */

export const TENANT_STATUS_KEYS = ["active", "trial", "past_due", "suspended", "cancelled"] as const;
export type TenantStatusKey = (typeof TENANT_STATUS_KEYS)[number];

/** Veri durumu süzgeci (URL `veri=`): demo = örnek veri yüklü (tenants.sample_seeded_at dolu), gercek = yüklü değil. */
export const DATA_STATE_LABELS: Record<"demo" | "gercek", string> = { demo: "Demo veri var", gercek: "Gerçek veri" };
export const TRIAL_LABELS: Record<"bitiyor" | "bitti", string> = { bitiyor: "Deneme 7 gün içinde bitiyor", bitti: "Denemesi biten" };
/** Paket dağılımı grafiği tabanı (URL `dagilim=`): tüm ofisler ya da yalnız aktif aboneler. */
export const DISTRIBUTION_LABELS: Record<"tum" | "aktif", string> = { tum: "Tüm ofisler", aktif: "Aktif aboneler" };
const DAY_WINDOWS = new Set(["7", "30", "90"]);
/** Sanal durum süzgeci: abonelik `status='active' AND current_period_end < şimdi` olan ofisler (dikkat kuyruğu kartı). */
export const EXPIRED_ACTIVE_FILTER = "donemi-bitmis" as const;
export const EXPIRED_ACTIVE_LABEL = "Dönemi bitmiş ama aktif";
const VIRTUAL_STATUS = new Set<string>(["risk", EXPIRED_ACTIVE_FILTER]);

export type TenantFilters = {
  q?: string;
  /** tenants.status ya da sanal `risk` (gecikmiş + askıda) / `donemi-bitmis` (aboneliği aktif ama dönemi geçmiş). */
  durum?: TenantStatusKey | "risk" | typeof EXPIRED_ACTIVE_FILTER;
  plan?: string;
  veri?: "demo" | "gercek";
  /** Kayıt penceresi (gün). */
  yeni?: "7" | "30" | "90";
  deneme?: "bitiyor" | "bitti";
  /** `deneme=bitti` penceresi (gün; varsayılan 30). */
  gun?: "7" | "30" | "90";
  dagilim?: "aktif";
  /** CRM (AD5): etiket kimliği. */
  etiket?: string;
  /** CRM: sorumlu personel kimliği, `ben` (oturumdaki personel) ya da `yok` (atanmamış). */
  sorumlu?: string;
  asama?: LifecycleStage;
  skor?: HealthBand;
  sayfa?: number;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEALTH_BANDS = new Set<string>(["riskli", "izlenmeli", "saglikli"]);

export type RawTenantSearch = Partial<Record<"q" | "durum" | "plan" | "veri" | "yeni" | "deneme" | "gun" | "dagilim" | "etiket" | "sorumlu" | "asama" | "skor" | "sayfa", string>>;

export function parseTenantFilters(sp: RawTenantSearch, isPlan: (id: string) => boolean): TenantFilters {
  const durum = sp.durum && ((TENANT_STATUS_KEYS as readonly string[]).includes(sp.durum) || VIRTUAL_STATUS.has(sp.durum)) ? (sp.durum as TenantFilters["durum"]) : undefined;
  const deneme = sp.deneme === "bitiyor" || sp.deneme === "bitti" ? sp.deneme : undefined;
  const n = Number(sp.sayfa);
  return {
    q: (sp.q ?? "").trim().slice(0, 80) || undefined,
    durum,
    plan: sp.plan && isPlan(sp.plan) ? sp.plan : undefined,
    veri: sp.veri === "demo" || sp.veri === "gercek" ? sp.veri : undefined,
    yeni: sp.yeni && DAY_WINDOWS.has(sp.yeni) ? (sp.yeni as TenantFilters["yeni"]) : undefined,
    deneme,
    gun: deneme === "bitti" ? (sp.gun && DAY_WINDOWS.has(sp.gun) ? (sp.gun as TenantFilters["gun"]) : "30") : undefined,
    dagilim: sp.dagilim === "aktif" ? "aktif" : undefined,
    etiket: sp.etiket && UUID_RE.test(sp.etiket) ? sp.etiket.toLowerCase() : undefined,
    sorumlu: sp.sorumlu && (sp.sorumlu === "ben" || sp.sorumlu === "yok" || UUID_RE.test(sp.sorumlu)) ? sp.sorumlu.toLowerCase() : undefined,
    asama: isLifecycleStage(sp.asama) ? sp.asama : undefined,
    skor: sp.skor && HEALTH_BANDS.has(sp.skor) ? (sp.skor as HealthBand) : undefined,
    sayfa: Number.isInteger(n) && n > 1 ? n : undefined,
  };
}

/** Liste süzgeci etkin mi (dağılım tabanı ve sayfa süzgeç değildir). */
export function isFiltered(f: TenantFilters): boolean {
  return Boolean(f.q || f.durum || f.plan || f.veri || f.yeni || f.deneme || f.etiket || f.sorumlu || f.asama || f.skor);
}

/** Href: verilen süzgeçler + sayfa. Süzgeç değişince sayfa 1'e döner (çağıran `sayfa` vermez). */
export function tenantsHref(f: TenantFilters): string {
  const sp = new URLSearchParams();
  if (f.q) sp.set("q", f.q);
  if (f.durum) sp.set("durum", f.durum);
  if (f.plan) sp.set("plan", f.plan);
  if (f.veri) sp.set("veri", f.veri);
  if (f.yeni) sp.set("yeni", f.yeni);
  if (f.deneme) sp.set("deneme", f.deneme);
  if (f.deneme === "bitti" && f.gun && f.gun !== "30") sp.set("gun", f.gun);
  if (f.dagilim) sp.set("dagilim", f.dagilim);
  if (f.etiket) sp.set("etiket", f.etiket);
  if (f.sorumlu) sp.set("sorumlu", f.sorumlu);
  if (f.asama) sp.set("asama", f.asama);
  if (f.skor) sp.set("skor", f.skor);
  if (f.sayfa && f.sayfa > 1) sp.set("sayfa", String(f.sayfa));
  const s = sp.toString();
  return s ? `/admin/tenants?${s}` : "/admin/tenants";
}

/** Tek süzgeci aç/kapat (aynı değer tekrar seçilirse kaldırılır), sayfa sıfırlanır. */
export function toggleFilter<K extends keyof TenantFilters>(f: TenantFilters, key: K, value: TenantFilters[K]): string {
  const next: TenantFilters = { ...f, sayfa: undefined };
  next[key] = (f[key] === value ? undefined : value) as TenantFilters[K];
  if (key === "deneme" && next.deneme !== "bitti") next.gun = undefined;
  return tenantsHref(next);
}

export type ActiveChip = { key: string; label: string; removeHref: string };

export type CrmNames = { tag?: (id: string) => string; staff?: (id: string) => string };

export function activeChips(f: TenantFilters, planName: (id: string) => string, statusName: (id: string) => string, crm: CrmNames = {}): ActiveChip[] {
  const drop = (patch: Partial<TenantFilters>) => tenantsHref({ ...f, ...patch, sayfa: undefined });
  const chips: ActiveChip[] = [];
  if (f.q) chips.push({ key: "q", label: `Arama: ${f.q}`, removeHref: drop({ q: undefined }) });
  if (f.durum) {
    const name = f.durum === "risk" ? "Riskli (gecikmiş + askıda)" : f.durum === EXPIRED_ACTIVE_FILTER ? EXPIRED_ACTIVE_LABEL : statusName(f.durum);
    chips.push({ key: "durum", label: `Durum: ${name}`, removeHref: drop({ durum: undefined }) });
  }
  if (f.plan) chips.push({ key: "plan", label: `Paket: ${planName(f.plan)}`, removeHref: drop({ plan: undefined }) });
  if (f.veri) chips.push({ key: "veri", label: `Veri: ${DATA_STATE_LABELS[f.veri]}`, removeHref: drop({ veri: undefined }) });
  if (f.yeni) chips.push({ key: "yeni", label: `Kayıt: son ${f.yeni} gün`, removeHref: drop({ yeni: undefined }) });
  if (f.deneme) chips.push({ key: "deneme", label: `${TRIAL_LABELS[f.deneme]}${f.deneme === "bitti" ? ` · son ${f.gun ?? "30"} gün` : ""}`, removeHref: drop({ deneme: undefined, gun: undefined }) });
  if (f.etiket) chips.push({ key: "etiket", label: `Etiket: ${crm.tag?.(f.etiket) ?? "seçili etiket"}`, removeHref: drop({ etiket: undefined }) });
  if (f.sorumlu) {
    const who = f.sorumlu === "ben" ? "Ben" : f.sorumlu === "yok" ? "Atanmamış" : (crm.staff?.(f.sorumlu) ?? "seçili personel");
    chips.push({ key: "sorumlu", label: `Sorumlu: ${who}`, removeHref: drop({ sorumlu: undefined }) });
  }
  if (f.asama) chips.push({ key: "asama", label: `Aşama: ${LIFECYCLE_LABELS[f.asama]}`, removeHref: drop({ asama: undefined }) });
  if (f.skor) chips.push({ key: "skor", label: `Sağlık: ${HEALTH_BAND_LABELS[f.skor]}`, removeHref: drop({ skor: undefined }) });
  return chips;
}

// ---- Envanter sayımları (tüm ofisler; filtre yalnız listeyi daraltır) ---------------------------

export type InventoryRow = { plan: string; status: string; sample_seeded_at: string | null; trial_ends_at: string | null; created_at: string };

export type TenantInventory = {
  total: number;
  /** 30 gün önceki toplam (kayıt tarihine göre; silinen ofis hesaba girmez). */
  totalPrev30: number;
  newLast30: number;
  byStatus: Record<TenantStatusKey, number>;
  byPlan: Record<string, number>;
  byPlanActive: Record<string, number>;
  demo: number;
  trialEnding7: number;
};

/** `nowIso`, `ago30Iso`, `in7Iso`: çağıran clock.ts'ten verir (saf fonksiyon). ISO karşılaştırması sözlük sırasıyla. */
export function tenantInventory(rows: readonly InventoryRow[], t: { nowIso: string; ago30Iso: string; in7Iso: string }): TenantInventory {
  const byStatus = Object.fromEntries(TENANT_STATUS_KEYS.map((k) => [k, 0])) as Record<TenantStatusKey, number>;
  const byPlan: Record<string, number> = {};
  const byPlanActive: Record<string, number> = {};
  let demo = 0;
  let trialEnding7 = 0;
  let newLast30 = 0;
  const ms = (iso: string | null) => (iso ? Date.parse(iso) : Number.NaN);
  const now = ms(t.nowIso);
  const ago30 = ms(t.ago30Iso);
  const in7 = ms(t.in7Iso);
  for (const r of rows) {
    if ((TENANT_STATUS_KEYS as readonly string[]).includes(r.status)) byStatus[r.status as TenantStatusKey] += 1;
    byPlan[r.plan] = (byPlan[r.plan] ?? 0) + 1;
    if (r.status === "active") byPlanActive[r.plan] = (byPlanActive[r.plan] ?? 0) + 1;
    if (r.sample_seeded_at) demo += 1;
    const end = ms(r.trial_ends_at);
    if (r.status === "trial" && end >= now && end <= in7) trialEnding7 += 1;
    if (ms(r.created_at) >= ago30) newLast30 += 1;
  }
  return { total: rows.length, totalPrev30: rows.length - newLast30, newLast30, byStatus, byPlan, byPlanActive, demo, trialEnding7 };
}

// ---- Etkinlik rozeti (son 14 gün denetim kaydı) ---------------------------------------------------

export type ActivityHealth = { label: string; tone: "success" | "warn" | "danger" | "neutral"; n: number | null };

/** null = sayım alınamadı (sorgu hatası) → "bilinmiyor"; uydurma "hareketsiz" yazılmaz. */
export function activityHealth(n: number | null): ActivityHealth {
  if (n === null) return { label: "Bilinmiyor", tone: "neutral", n: null };
  if (n >= 10) return { label: "Etkin", tone: "success", n };
  if (n > 0) return { label: "Sessiz", tone: "warn", n };
  return { label: "Hareketsiz", tone: "danger", n };
}
