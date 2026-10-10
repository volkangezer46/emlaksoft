import Link from "@/components/ui/smart-link";
import { AlertTriangle, Clock, Hand, Inbox, Layers, Settings2 } from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { createClient } from "@/lib/supabase/server";
import { ListHero, ListPage } from "@/components/ui/list-page";
import { EmptyState } from "@/components/ui/empty-state";
import { StatRow } from "@/components/ui/stat-row";
import { hasOfficeWideDataScope } from "@/lib/permission-data-scope";
import { msSince, now } from "@/lib/clock";
import { isMissingSchemaError } from "@/lib/property-owner/info";
import { isClaimOpen, POOL_MODES, slaState } from "@/lib/pool/modes";
import { rankCandidates, type PoolSuggestion } from "@/lib/pool/score";
import { isPoolEnabled, loadPoolCandidates, loadPoolRule, toPoolProperty } from "@/lib/pool/server";
import { formatTry } from "@/lib/utils";
import { PoolEntryPanel, type PanelSuggestion } from "./pool-entry-panel";
import { PoolSettingsForm } from "./pool-settings-form";
import { PoolEnableButton } from "./pool-enable-button";
import { QuickAssign, type QuickSuggestion } from "./quick-assign";
import { getDistrictsByIds, getNeighborhoodsByIds, getProvincesByIds } from "@/lib/geo/reader";
import { parseAssignView } from "@/lib/office-center/logic";
import { loadUnassignedProperties } from "@/lib/office-center/store";
import { AssignmentSection, assignBranchOf } from "./assignment-section";

export const metadata = { title: "Havuz ve atama" };

const PAGE = "/app/ilan-havuzu";
const LIMIT = 50;
const dtf = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" });

const SOURCE_LABELS: Record<string, string> = {
  manual: "Elle ekleme",
  import: "İçe aktarma",
  portal_form: "Portal / form",
  network: "Ağ / MLS",
  api: "API",
  transfer: "Devir",
};
const EVENT_LABELS: Record<string, string> = {
  created: "Havuza düştü",
  suggested: "Öneri üretildi",
  claim_opened: "Kendine almaya açıldı",
  assigned: "Atandı",
  reassigned: "Yeniden atandı",
  skipped: "Atlandı",
  withdrawn: "Geri çekildi",
  sla_breached: "Gecikti",
  escalated: "Yönetime yükseltildi",
};

type Tab = "bekleyen" | "gecmis" | "ayarlar";
const HISTORY_VIEWS = ["gecmis", "aktif", "iptal", "yeniden"];
const FILTERS = [
  { value: "", label: "Hepsi" },
  { value: "gecikmis", label: "Gecikenler" },
  { value: "sahiplen", label: "Kendine alınabilir" },
] as const;

type Row = Record<string, unknown>;
const s = (v: unknown): string => (typeof v === "string" ? v : "");

function tabHref(tab: Tab, durum?: string): string {
  const p = new URLSearchParams();
  if (tab !== "bekleyen") p.set("sekme", tab);
  if (durum) p.set("durum", durum);
  const q = p.toString();
  return q ? `${PAGE}?${q}` : PAGE;
}

function lateTone(state: string): string {
  if (state === "breached") return "bg-danger-500/10 text-danger-600";
  if (state === "due_soon") return "bg-amber-500/10 text-amber-700";
  return "bg-mint-500/10 text-mint-700";
}

/** Tek satır gerekçe: en çok puan getiren en çok iki ölçüt ("Bölgeyi biliyor (Kadıköy) · Az yüklü"). */
function reasonLine(reasons: PoolSuggestion["reasons"]): string {
  return [...reasons]
    .filter((r) => r.points > 0)
    .sort((a, b) => b.points - a.points)
    .slice(0, 2)
    .map((r) => (r.detail ? `${r.label} (${r.detail})` : r.label))
    .join(" · ");
}

/** Birleşik bekleyen ilan satırı: havuz kaydı (varsa) + danışmansız ilan tek kartta. */
type Item = {
  key: string;
  propertyId: string;
  entryId: string | null;
  title: string;
  meta: string;
  price: number | null;
  source: string;
  sinceMs: number;
  late: "ok" | "due_soon" | "breached" | "none";
  dueMs: number | null;
  claimOpen: boolean;
  claimMs: number | null;
  entry: Row | null;
};

/**
 * HAVUZ VE ATAMA — tek "Bekleyen ilanlar" listesi. İki atama modeli (havuz kaydı + havuza girmemiş danışmansız ilan) tek
 * listede birleşik; her kartta önerilen danışman (gerekçe tek satır) ve tek tık "Ata". "Geçmiş" ve "Atama ayarları" ikincil
 * sekmelerdir. Filtre kontratı: `?sekme=` (bekleyen|gecmis|ayarlar), `?durum=` (gecikmis|sahiplen), geçmiş görünümü `?atama=`.
 * Eski bağlantılar çalışır: `?atama=bekleyen|gecikmis` → liste, `?atama=gecmis|aktif|iptal|yeniden` ve `?durum=atanan` → Geçmiş.
 */
export default async function ListingPoolPage({ searchParams }: { searchParams?: Promise<{ sekme?: string; durum?: string; atama?: string }> }) {
  const { role, tenantId, userId, perms } = await requireModulePage("properties", PAGE);
  const { sekme: rawSekme = "", durum: rawDurum = "", atama: rawAtama = "" } = (await searchParams) ?? {};
  const canManage = hasOfficeWideDataScope(role);
  const canConfigure = role === "owner" || role === "gm";
  // Atama görünümleri Ofis Merkezi iznine bağlı (atama eylemleri de office_center:edit ister).
  const canSeeAssign = (perms.office_center ?? []).includes("view");
  const canAssign = (perms.office_center ?? []).includes("edit");

  const legacyHistory = HISTORY_VIEWS.includes(rawAtama) || rawDurum === "atanan";
  let tab: Tab = rawSekme === "gecmis" || rawSekme === "ayarlar" || rawSekme === "bekleyen" ? rawSekme : legacyHistory ? "gecmis" : "bekleyen";
  if (tab === "gecmis" && !canSeeAssign) tab = "bekleyen";
  if (tab === "ayarlar" && !canConfigure) tab = "bekleyen";
  const durum = rawDurum === "gecikmis" || rawAtama === "gecikmis" ? "gecikmis" : rawDurum === "sahiplen" ? "sahiplen" : "";

  if (!tenantId) {
    return (
      <div className="space-y-6">
        <ListHero eyebrow="Portföy" art="havuz" title="Havuz ve atama" description="Havuz ofis hesabıyla çalışır." />
      </div>
    );
  }

  const supabase = await createClient();
  const nowMs = now();
  const nowIso = new Date(nowMs).toISOString();

  const count = (patch: (q: ReturnType<typeof base>) => ReturnType<typeof base>) => patch(base());
  function base() {
    return supabase.from("listing_pool_entries").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId as string);
  }

  const branchId = canSeeAssign ? await assignBranchOf({ supabase, tenantId, userId, role }) : null;

  let list = supabase
    .from("listing_pool_entries")
    .select("id, property_id, source, status, rule_id, top_score, created_at, sla_due_at, claim_open_until, assigned_to, assigned_at, assign_method", { count: "exact" })
    .eq("tenant_id", tenantId)
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  if (durum === "gecikmis") list = list.lt("sla_due_at", nowIso);
  if (durum === "sahiplen") list = list.gte("claim_open_until", nowIso);

  const onList = tab === "bekleyen";
  const [listRes, pendingRes, lateRes, claimRes, enabled, rule, unassignedRes, advisorsRes] = await Promise.all([
    onList ? list.limit(LIMIT) : Promise.resolve({ data: [] as Row[], count: 0, error: null }),
    count((q) => q.eq("status", "pending")),
    count((q) => q.eq("status", "pending").lt("sla_due_at", nowIso)),
    count((q) => q.eq("status", "pending").gte("claim_open_until", nowIso)),
    isPoolEnabled(supabase, tenantId),
    loadPoolRule(supabase, tenantId, null),
    onList && canSeeAssign && durum !== "sahiplen"
      ? loadUnassignedProperties(supabase, tenantId, { nowMs, slaHours: 24, limit: LIMIT, onlyBreached: durum === "gecikmis", branchId })
      : Promise.resolve(null),
    onList && (canManage || canAssign)
      ? (() => {
          let q = supabase.from("profiles").select("id, full_name, branch_id").eq("tenant_id", tenantId).eq("is_active", true).in("role", ["owner", "gm", "branch_manager", "team_lead", "advisor"]).order("full_name").limit(500);
          if (branchId) q = q.eq("branch_id", branchId);
          return q;
        })()
      : Promise.resolve({ data: [] as Row[] }),
  ]);

  if (listRes.error && isMissingSchemaError(listRes.error)) {
    return (
      <div className="space-y-6">
        <ListHero eyebrow="Portföy" art="havuz" title="Havuz ve atama" description="Sahibi olmayan ilanları uygun danışmanlara dağıtın." />
        <EmptyState
          illustration="portfoy"
          icon={Layers}
          title="İlan havuzu henüz etkin değil"
          description="Havuz için veritabanı güncellemesi bekleniyor. Güncelleme uygulanana dek ilan ekleme ve atama akışı olduğu gibi çalışır."
          tone="brand"
          action={{ href: "/app/portfoyler", label: "Portföylere git" }}
        />
      </div>
    );
  }

  const entries = (listRes.data ?? []) as Row[];
  const advisors = ((advisorsRes.data ?? []) as Row[]).map((a) => ({ id: s(a.id), name: s(a.full_name) || "Danışman" }));
  const unassignedRows = unassignedRes && !unassignedRes.failed ? unassignedRes.rows : [];
  const entryProps = new Set(entries.map((e) => s(e.property_id)));
  // Havuz kaydı olan danışmansız ilanlar zaten havuz satırı olarak gelir; yalnız havuza girmemişler eklenir.
  const looseRows = unassignedRows.filter((p) => !p.poolEntryId && !entryProps.has(p.id));

  const propIds = [...new Set([...entries.map((e) => s(e.property_id)), ...looseRows.map((p) => p.id)].filter(Boolean))];
  const entryIds = entries.map((e) => s(e.id));
  const { data: propRows } = propIds.length
    ? await supabase
        .from("properties")
        .select("id, property_code, title, property_type, transaction_type, list_price, province_id, district_id, neighborhood_id, status")
        .eq("tenant_id", tenantId)
        .in("id", propIds)
    : { data: [] as Row[] };
  const props = new Map(((propRows ?? []) as Row[]).map((p) => [s(p.id), p]));

  const geoIds = (key: string) => [...new Set([...props.values()].map((p) => s(p[key])).filter(Boolean))];
  const needCandidates = (canManage || canAssign) && propIds.length > 0;
  const [nbRes, dsRes, pvRes, evRes, candidateBundle] = await Promise.all([
    getNeighborhoodsByIds(geoIds("neighborhood_id")).then((data) => ({ data: data as unknown as Row[] })),
    getDistrictsByIds(geoIds("district_id")).then((data) => ({ data: data as unknown as Row[] })),
    getProvincesByIds(geoIds("province_id")).then((data) => ({ data: data as unknown as Row[] })),
    entryIds.length
      ? supabase
          .from("listing_pool_events")
          .select("entry_id, event, actor_id, from_profile_id, to_profile_id, score, reason, created_at")
          .eq("tenant_id", tenantId)
          .in("entry_id", entryIds)
          .order("created_at", { ascending: false })
          .limit(400)
      : Promise.resolve({ data: [] as Row[] }),
    needCandidates ? loadPoolCandidates(supabase, tenantId, nowMs, rule.id) : Promise.resolve(null),
  ]);
  const nameOf = (rows: unknown) => new Map(((rows ?? []) as Row[]).map((r) => [s(r.id), s(r.name)]));
  const nb = nameOf(nbRes.data);
  const ds = nameOf(dsRes.data);
  const pv = nameOf(pvRes.data);

  const events = (evRes.data ?? []) as Row[];
  const names = new Map<string, string>();
  for (const c of candidateBundle?.candidates ?? []) names.set(c.profileId, c.name);
  for (const a of advisors) names.set(a.id, a.name);
  const profileIds = new Set<string>();
  for (const ev of events) for (const k of ["actor_id", "from_profile_id", "to_profile_id"]) if (s(ev[k])) profileIds.add(s(ev[k]));
  const missingNames = [...profileIds].filter((id) => !names.has(id));
  if (missingNames.length) {
    const { data } = await supabase.from("profiles").select("id, full_name").eq("tenant_id", tenantId).in("id", missingNames);
    for (const p of (data ?? []) as Row[]) names.set(s(p.id), s(p.full_name) || "Danışman");
  }
  const eventsBy = new Map<string, Row[]>();
  for (const ev of events) {
    const l = eventsBy.get(s(ev.entry_id)) ?? [];
    if (l.length < 8) l.push(ev);
    eventsBy.set(s(ev.entry_id), l);
  }

  const placeOf = (p: Row | undefined) => (p ? [nb.get(s(p.neighborhood_id)), ds.get(s(p.district_id)), pv.get(s(p.province_id))].filter(Boolean).join(", ") : "");
  const metaOf = (p: Row | undefined, place: string) => [p ? s(p.transaction_type) : "", p ? s(p.property_type) : "", place].filter(Boolean).join(" · ");

  const items: Item[] = [
    ...entries.map((e): Item => {
      const p = props.get(s(e.property_id));
      const dueMs = s(e.sla_due_at) ? Date.parse(s(e.sla_due_at)) : null;
      const claimMs = s(e.claim_open_until) ? Date.parse(s(e.claim_open_until)) : null;
      const createdMs = Date.parse(s(e.created_at));
      return {
        key: `e-${s(e.id)}`,
        propertyId: s(e.property_id),
        entryId: s(e.id),
        title: p ? s(p.title) || s(p.property_code) || "İlan" : "İlan",
        meta: metaOf(p, placeOf(p)),
        price: p && p.list_price != null ? Number(p.list_price) : null,
        source: SOURCE_LABELS[s(e.source)] ?? s(e.source),
        sinceMs: createdMs,
        late: slaState({ dueMs, createdMs, nowMs }),
        dueMs,
        claimOpen: isClaimOpen(claimMs, nowMs),
        claimMs,
        entry: e,
      };
    }),
    ...looseRows.map((u): Item => {
      const p = props.get(u.id);
      return {
        key: `p-${u.id}`,
        propertyId: u.id,
        entryId: null,
        title: u.title,
        meta: metaOf(p, placeOf(p) || u.place),
        price: u.listPrice,
        source: "Danışmansız ilan",
        sinceMs: Date.parse(u.createdAt),
        late: u.slaState,
        dueMs: null,
        claimOpen: false,
        claimMs: null,
        entry: null,
      };
    }),
  ].sort((a, b) => (a.late === "breached" ? 0 : 1) - (b.late === "breached" ? 0 : 1) || a.sinceMs - b.sinceMs);

  const pendingTotal = Math.max(pendingRes.count ?? 0, items.length);
  const modeMeta = POOL_MODES.find((m) => m.value === rule.mode);

  const tabs: { id: Tab; label: string; show: boolean }[] = [
    { id: "bekleyen", label: "Bekleyen ilanlar", show: true },
    { id: "gecmis", label: "Geçmiş", show: canSeeAssign },
    { id: "ayarlar", label: "Atama ayarları", show: canConfigure },
  ];

  return (
    <ListPage>
      <div data-tour="ilan-havuzu" className="space-y-6">
        <ListHero
          art="havuz"
          eyebrow="Portföy"
          title="Havuz ve atama"
          description="Sahibi olmayan ilanlar burada bekler. Önerilen danışmanı tek tıkla atayın."
          meta={
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${enabled ? "bg-mint-500/10 text-mint-700" : "bg-canvas text-text-muted"}`}>
              {enabled ? `Açık · ${modeMeta?.label ?? "Yarı otomatik"}` : "Kapalı"}
            </span>
          }
        />

        <nav aria-label="Havuz bölümleri" className="flex flex-wrap gap-1">
          {tabs
            .filter((t) => t.show)
            .map((t) => (
              <Link
                key={t.id}
                href={tabHref(t.id)}
                aria-current={tab === t.id ? "page" : undefined}
                className={`focus-ring inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold transition ${tab === t.id ? "bg-brand-600 text-white" : "text-text-muted hover:bg-surface-hover hover:text-text"}`}
              >
                {t.label}
              </Link>
            ))}
        </nav>

        {tab === "bekleyen" ? (
          <>
            <StatRow
              label="Bekleyen ilan özeti"
              items={[
                { label: "Bekleyen ilan", value: pendingTotal, href: tabHref("bekleyen"), icon: <Inbox className="h-4 w-4" aria-hidden="true" /> },
                { label: "Gecikenler", value: lateRes.count ?? 0, href: tabHref("bekleyen", "gecikmis"), attention: true, icon: <AlertTriangle className="h-4 w-4" aria-hidden="true" /> },
                { label: "Kendine alınabilir", value: claimRes.count ?? 0, href: tabHref("bekleyen", "sahiplen"), icon: <Hand className="h-4 w-4" aria-hidden="true" /> },
              ]}
            />

            {!enabled && canConfigure ? (
              <section className="flex flex-col items-center gap-3 rounded-[var(--radius-panel)] border border-dashed border-line-strong bg-surface p-8 text-center">
                <Inbox className="h-8 w-8 text-brand-600" aria-hidden="true" />
                <h2 className="font-display text-lg font-bold text-ink-950">İlan havuzu kapalı</h2>
                <p className="max-w-md text-sm text-text-muted">
                  Havuzu açınca sahibi olmayan, içe aktarılan ve portaldan gelen ilanlar burada toplanır ve uygun danışmana önerilir.
                </p>
                <PoolEnableButton mode={rule.mode} minScore={rule.minScore} slaMinutes={rule.slaMinutes} />
              </section>
            ) : null}

            <nav aria-label="Bekleyen ilan filtresi" className="flex flex-wrap items-center gap-1.5">
              {FILTERS.map((f) => {
                const on = durum === f.value;
                return (
                  <Link
                    key={f.value || "hepsi"}
                    href={tabHref("bekleyen", f.value)}
                    aria-current={on ? "page" : undefined}
                    className={`inline-flex min-h-9 touch:min-h-11 items-center rounded-full border px-3 text-xs font-semibold transition ${on ? "border-brand-400 bg-brand-50 text-brand-700" : "border-line bg-surface text-text-muted hover:bg-canvas"}`}
                  >
                    {f.label}
                  </Link>
                );
              })}
              <span className="ml-auto text-xs text-text-muted">
                {items.length} ilan{pendingTotal > items.length ? ` · ilk ${items.length}` : ""}
              </span>
            </nav>

            {items.length === 0 ? (
              <EmptyState
                illustration="portfoy"
                icon={Layers}
                title={durum === "gecikmis" ? "Geciken ilan yok" : durum === "sahiplen" ? "Kendine alınabilir ilan yok" : "Bekleyen ilan yok"}
                description={
                  enabled
                    ? "Yeni ilanlar sahipsiz kalınca burada önerilen danışmanla listelenir."
                    : "Havuz kapalıyken yalnız danışmanı olmayan ilanlar burada görünür; şu an hepsinin bir danışmanı var."
                }
                tone="brand"
                action={{ href: "/app/portfoyler/yeni", label: "Yeni portföy ekle" }}
              />
            ) : (
              <ul className="space-y-4">
                {items.map((it) => {
                  const p = props.get(it.propertyId);
                  const ageHours = Math.floor(msSince(new Date(it.sinceMs).toISOString()) / 3_600_000);
                  const history = it.entryId ? (eventsBy.get(it.entryId) ?? []) : [];

                  let ranked: PoolSuggestion[] = [];
                  if (candidateBundle && p) {
                    ranked = rankCandidates(candidateBundle.candidates, toPoolProperty(p), {
                      nowMs,
                      officeAvgOpen: candidateBundle.officeAvgOpen,
                      labels: { neighborhood: nb.get(s(p.neighborhood_id)), district: ds.get(s(p.district_id)), province: pv.get(s(p.province_id)) },
                    });
                  }
                  const top = ranked.find((r) => !r.excluded);
                  const quick: QuickSuggestion | null = top ? { profileId: top.profileId, name: top.name, score: top.score, reason: reasonLine(top.reasons) } : null;
                  const panelSuggestions: PanelSuggestion[] = ranked.map((r) => ({
                    profileId: r.profileId,
                    name: r.name,
                    score: r.score,
                    reasons: r.reasons,
                    excludedReason: r.excluded?.reason,
                  }));
                  const canQuick = it.entryId ? canManage : canAssign;

                  return (
                    <li key={it.key} className={`rounded-[var(--radius-panel)] border bg-surface p-5 shadow-[var(--shadow-xs)] ${it.late === "breached" ? "border-danger-500/40" : "border-line"}`}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <Link href={`/app/portfoyler/${it.propertyId}`} className="font-display font-bold text-ink-950 hover:text-brand-600">
                            {it.title}
                          </Link>
                          <p className="mt-0.5 text-xs text-text-muted">{it.meta || "Konum bilgisi yok"}</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          {it.price != null ? <span className="numeric font-semibold text-ink-950">{formatTry(it.price)}</span> : null}
                          <span className="rounded-full bg-canvas px-2 py-0.5 font-semibold text-text-muted">{it.source}</span>
                          <span className="inline-flex items-center gap-1 rounded-full bg-canvas px-2 py-0.5 font-semibold text-text-muted">
                            <Clock className="h-3 w-3" aria-hidden="true" /> {ageHours < 1 ? "az önce" : ageHours < 48 ? `${ageHours} saattir` : `${Math.floor(ageHours / 24)} gündür`} bekliyor
                          </span>
                          {it.late !== "none" && it.late !== "ok" ? (
                            <span className={`rounded-full px-2 py-0.5 font-semibold ${lateTone(it.late)}`}>
                              {it.late === "breached" ? "Gecikti" : "Gecikmek üzere"}
                              {it.dueMs ? ` · ${dtf.format(it.dueMs)}` : ""}
                            </span>
                          ) : null}
                          {it.claimOpen && it.claimMs ? <span className="rounded-full bg-brand-50 px-2 py-0.5 font-semibold text-brand-700">Kendine alınabilir · {dtf.format(it.claimMs)} dek</span> : null}
                        </div>
                      </div>

                      <div className="mt-4 space-y-3">
                        {canQuick ? <QuickAssign target={it.entryId ? { kind: "pool", entryId: it.entryId } : { kind: "property", propertyId: it.propertyId }} suggestion={quick} advisors={advisors} /> : null}
                        {it.entryId && (it.claimOpen || canManage) ? (
                          canManage ? (
                            <details className="text-sm">
                              <summary className="cursor-pointer text-xs font-semibold text-text-muted">Diğer seçenekler (neden bu danışman, atla, kendine almaya aç)</summary>
                              <div className="mt-3">
                                <PoolEntryPanel entryId={it.entryId} mode={rule.mode} canManage claimOpen={it.claimOpen} suggestions={panelSuggestions} />
                              </div>
                            </details>
                          ) : (
                            <PoolEntryPanel entryId={it.entryId} mode={rule.mode} canManage={false} claimOpen={it.claimOpen} suggestions={[]} />
                          )
                        ) : null}
                        {!canQuick && !it.entryId ? <p className="text-xs text-text-muted">Atamayı ofis yönetimi yapar.</p> : null}
                      </div>

                      {history.length > 0 ? (
                        <details className="mt-3 text-xs text-text-muted">
                          <summary className="cursor-pointer font-semibold">Olay geçmişi ({history.length})</summary>
                          <ol className="mt-2 space-y-1 border-l border-line pl-3">
                            {history.map((ev, i) => (
                              <li key={i}>
                                <span className="font-semibold text-ink-950">{EVENT_LABELS[s(ev.event)] ?? s(ev.event)}</span>
                                {s(ev.to_profile_id) ? ` → ${names.get(s(ev.to_profile_id)) ?? "danışman"}` : ""}
                                {s(ev.from_profile_id) ? ` (önceki: ${names.get(s(ev.from_profile_id)) ?? "danışman"})` : ""}
                                {ev.score != null ? ` · ${Number(ev.score)} puan` : ""}
                                {s(ev.reason) ? ` · ${s(ev.reason)}` : ""}
                                {s(ev.actor_id) ? ` · ${names.get(s(ev.actor_id)) ?? "kullanıcı"}` : " · sistem"}
                                <span className="text-text-faint"> · {dtf.format(Date.parse(s(ev.created_at)))}</span>
                              </li>
                            ))}
                          </ol>
                        </details>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        ) : null}

        {tab === "gecmis" ? (
          <AssignmentSection
            ctx={{
              supabase,
              tenantId,
              userId,
              role,
              nowMs,
              canEdit: canAssign,
              view: HISTORY_VIEWS.includes(rawAtama) ? parseAssignView(rawAtama) : "gecmis",
            }}
          />
        ) : null}

        {tab === "ayarlar" && canConfigure ? (
          <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
            <h2 className="mb-4 flex items-center gap-2 font-display font-bold text-ink-950">
              <Settings2 className="h-4 w-4 text-brand-600" aria-hidden="true" /> Atama ayarları
            </h2>
            <PoolSettingsForm enabled={enabled} mode={rule.mode} minScore={rule.minScore} slaMinutes={rule.slaMinutes} />
          </section>
        ) : null}
      </div>
    </ListPage>
  );
}
