import { KpiGrid } from "@/components/ui/dashboard-grid";
import Link from "@/components/ui/smart-link";
import { AlertTriangle, CheckCircle2, Clock, Hand, Inbox, Layers, Settings2, UserX } from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { createClient } from "@/lib/supabase/server";
import { ListHero, ListPage } from "@/components/ui/list-page";
import { StatCard } from "@/components/app/stat-card";
import { EmptyState } from "@/components/ui/empty-state";
import { hasOfficeWideDataScope } from "@/lib/permission-data-scope";
import { daysAgoIso, msSince, now } from "@/lib/clock";
import { isMissingSchemaError } from "@/lib/property-owner/info";
import { isClaimOpen, POOL_MODES, slaState } from "@/lib/pool/modes";
import { rankCandidates, type PoolSuggestion } from "@/lib/pool/score";
import { isPoolEnabled, loadPoolCandidates, loadPoolRule, toPoolProperty } from "@/lib/pool/server";
import { formatTry } from "@/lib/utils";
import { PoolEntryPanel, type PanelSuggestion } from "./pool-entry-panel";
import { PoolSettingsForm } from "./pool-settings-form";
import { getDistrictsByIds, getNeighborhoodsByIds, getProvincesByIds } from "@/lib/geo/reader";
import { assignHref, parseAssignView } from "@/lib/office-center/logic";
import { loadUnassignedProperties } from "@/lib/office-center/store";
import { AssignmentSection, assignBranchOf } from "./assignment-section";

export const metadata = { title: "İlan havuzu" };

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
  extension: "Eklenti",
};
const EVENT_LABELS: Record<string, string> = {
  created: "Havuza düştü",
  suggested: "Öneri üretildi",
  claim_opened: "Sahiplenme açıldı",
  assigned: "Atandı",
  reassigned: "Yeniden atandı",
  skipped: "Atlandı",
  withdrawn: "Geri çekildi",
  sla_breached: "SLA aşıldı",
  escalated: "Yönetime yükseltildi",
};
const FILTERS = [
  { value: "bekleyen", label: "Bekleyen" },
  { value: "gecikmis", label: "SLA'sı geçen" },
  { value: "sahiplen", label: "Sahiplenmeye açık" },
  { value: "atanan", label: "Son 7 gün atanan" },
] as const;

type Row = Record<string, unknown>;
const s = (v: unknown): string => (typeof v === "string" ? v : "");

function href(durum: string) {
  return durum && durum !== "bekleyen" ? `${PAGE}?durum=${durum}` : PAGE;
}

function slaTone(state: string): string {
  if (state === "breached") return "bg-danger-500/10 text-danger-600";
  if (state === "due_soon") return "bg-amber-500/10 text-amber-700";
  return "bg-mint-500/10 text-mint-700";
}

/**
 * İLAN HAVUZU — TEK atama ekranı. Havuz kayıtları (kural/puan, sahiplenme, SLA) + Ofis Merkezi izni olana
 * "Danışmansız ilanlar" (akıllı öneri `smart-assign` + elle atama) ve "Atama geçmişi" (iptal / yeniden ata) görünümleri
 * (`?atama=`). Filtre kontratı: `?durum=` havuz, `?atama=` atama görünümü; sunucu sorgusu aynı değerleri okur.
 */
export default async function ListingPoolPage({ searchParams }: { searchParams?: Promise<{ durum?: string; atama?: string }> }) {
  const { role, tenantId, userId, perms } = await requireModulePage("properties", PAGE);
  const { durum: rawDurum = "", atama: rawAtama } = (await searchParams) ?? {};
  const durum = FILTERS.some((f) => f.value === rawDurum) ? rawDurum : "bekleyen";
  const canManage = hasOfficeWideDataScope(role);
  const canConfigure = role === "owner" || role === "gm";
  // Atama görünümleri Ofis Merkezi iznine bağlı (atama eylemleri de office_center:edit ister).
  const canSeeAssign = (perms.office_center ?? []).includes("view");
  const canAssign = (perms.office_center ?? []).includes("edit");
  const atama = canSeeAssign && rawAtama ? parseAssignView(rawAtama) : null;

  if (!tenantId) {
    return (
      <div className="space-y-6">
        <ListHero eyebrow="Portföy" art="havuz" title="İlan havuzu" description="Havuz ofis hesabıyla çalışır." />
      </div>
    );
  }

  const supabase = await createClient();
  const nowMs = now();
  const nowIso = new Date(nowMs).toISOString();
  const week = daysAgoIso(7);

  const count = (patch: (q: ReturnType<typeof base>) => ReturnType<typeof base>) => patch(base());
  function base() {
    return supabase.from("listing_pool_entries").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId as string);
  }

  let list = supabase
    .from("listing_pool_entries")
    .select("id, property_id, source, status, rule_id, top_score, created_at, sla_due_at, claim_open_until, assigned_to, assigned_at, assign_method", { count: "exact" })
    .eq("tenant_id", tenantId);
  if (durum === "atanan") list = list.eq("status", "assigned").gte("assigned_at", week).order("assigned_at", { ascending: false });
  else {
    list = list.eq("status", "pending").order("created_at", { ascending: true });
    if (durum === "gecikmis") list = list.lt("sla_due_at", nowIso);
    if (durum === "sahiplen") list = list.gte("claim_open_until", nowIso);
  }

  const branchId = canSeeAssign ? await assignBranchOf({ supabase, tenantId, userId, role }) : null;
  const [listRes, pendingRes, lateRes, claimRes, assignedRes, enabled, rule, unassignedRes] = await Promise.all([
    // Atama görünümünde havuz listesi çizilmez (yalnız sayaçlar).
    atama ? Promise.resolve({ data: [] as Row[], count: 0, error: null }) : list.limit(LIMIT),
    count((q) => q.eq("status", "pending")),
    count((q) => q.eq("status", "pending").lt("sla_due_at", nowIso)),
    count((q) => q.eq("status", "pending").gte("claim_open_until", nowIso)),
    count((q) => q.eq("status", "assigned").gte("assigned_at", week)),
    isPoolEnabled(supabase, tenantId),
    loadPoolRule(supabase, tenantId, null),
    canSeeAssign ? loadUnassignedProperties(supabase, tenantId, { nowMs, slaHours: 24, limit: 1, branchId }) : Promise.resolve(null),
  ]);

  if (listRes.error && isMissingSchemaError(listRes.error)) {
    return (
      <div className="space-y-6">
        <ListHero eyebrow="Portföy" art="havuz" title="İlan havuzu" description="Atanmamış ilanları uzmanlığa göre danışmanlara dağıtın." />
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
  const total = listRes.count ?? entries.length;
  const propIds = [...new Set(entries.map((e) => s(e.property_id)).filter(Boolean))];
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
    canManage && durum !== "atanan" ? loadPoolCandidates(supabase, tenantId, nowMs, rule.id) : Promise.resolve(null),
  ]);
  const nameOf = (rows: unknown) => new Map(((rows ?? []) as Row[]).map((r) => [s(r.id), s(r.name)]));
  const nb = nameOf(nbRes.data);
  const ds = nameOf(dsRes.data);
  const pv = nameOf(pvRes.data);

  // Ad çözümü: aday listesi (yöneticiler) veya olay/atama kimlikleri için tek sorgu.
  const profileIds = new Set<string>();
  for (const e of entries) if (s(e.assigned_to)) profileIds.add(s(e.assigned_to));
  const events = (evRes.data ?? []) as Row[];
  for (const ev of events) for (const k of ["actor_id", "from_profile_id", "to_profile_id"]) if (s(ev[k])) profileIds.add(s(ev[k]));
  const names = new Map<string, string>();
  for (const c of candidateBundle?.candidates ?? []) names.set(c.profileId, c.name);
  const missingNames = [...profileIds].filter((id) => !names.has(id));
  if (missingNames.length) {
    const { data } = await supabase.from("profiles").select("id, full_name").eq("tenant_id", tenantId).in("id", missingNames);
    for (const p of (data ?? []) as Row[]) names.set(s(p.id), s(p.full_name) || "Danışman");
  }
  const eventsBy = new Map<string, Row[]>();
  for (const ev of events) {
    const list2 = eventsBy.get(s(ev.entry_id)) ?? [];
    if (list2.length < 8) list2.push(ev);
    eventsBy.set(s(ev.entry_id), list2);
  }

  const modeMeta = POOL_MODES.find((m) => m.value === rule.mode);

  return (
    <ListPage>
      <ListHero
        art="havuz"
        eyebrow="Portföy"
        title="İlan havuzu"
        description="Atanmamış, içe aktarılmış, portal ve ağ kaynaklı ilanlar uzmanlığa göre açıklanabilir puanla danışmanlara dağıtılır."
        meta={
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${enabled ? "bg-mint-500/10 text-mint-700" : "bg-canvas text-text-muted"}`}>
            {enabled ? `Açık · ${modeMeta?.label ?? "Yarı otomatik"}` : "Kapalı"}
          </span>
        }
      />

      {/* Ürün turu hedefi: havuz sayaçları (data-tour="ilan-havuzu") */}
      <div data-tour="ilan-havuzu">
      <KpiGrid>
        <StatCard label="Bekleyen ilan" value={pendingRes.count ?? 0} icon={Inbox} tone="brand" href={href("bekleyen")} />
        <StatCard label="SLA'sı geçen" value={lateRes.count ?? 0} icon={AlertTriangle} tone={(lateRes.count ?? 0) > 0 ? "danger" : "warning"} href={href("gecikmis")} />
        <StatCard label="Sahiplenmeye açık" value={claimRes.count ?? 0} icon={Hand} tone="warning" href={href("sahiplen")} />
        <StatCard label="Son 7 gün atanan" value={assignedRes.count ?? 0} icon={CheckCircle2} tone="success" href={href("atanan")} />
        {unassignedRes && !unassignedRes.failed ? (
          <StatCard label="Danışmansız ilan" value={unassignedRes.total} icon={UserX} tone={unassignedRes.total > 0 ? "warning" : "neutral"} href={assignHref()} />
        ) : null}
      </KpiGrid>
      </div>

      {canConfigure ? (
        <details className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]" open={!enabled}>
          <summary className="flex cursor-pointer items-center gap-2 font-display font-bold text-ink-950">
            <Settings2 className="h-4 w-4 text-brand-600" /> Havuz ayarları
          </summary>
          <div className="mt-4">
            <PoolSettingsForm enabled={enabled} mode={rule.mode} minScore={rule.minScore} slaMinutes={rule.slaMinutes} />
          </div>
        </details>
      ) : null}

      <nav aria-label="Havuz filtresi" className="flex flex-wrap items-center gap-1.5">
        {FILTERS.map((f) => {
          const on = !atama && durum === f.value;
          return (
            <Link
              key={f.value}
              href={href(f.value)}
              aria-current={on ? "page" : undefined}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${on ? "border-brand-400 bg-brand-50 text-brand-700" : "border-line bg-surface text-text-muted hover:bg-canvas"}`}
            >
              {f.label}
            </Link>
          );
        })}
        {canSeeAssign
          ? (
              [
                { label: "Danışmansız ilanlar", href: assignHref(), on: atama === "bekleyen" || atama === "gecikmis" },
                { label: "Atama geçmişi", href: assignHref("gecmis"), on: atama === "gecmis" || atama === "aktif" || atama === "iptal" || atama === "yeniden" },
              ] as const
            ).map((f) => (
              <Link
                key={f.label}
                href={f.href}
                aria-current={f.on ? "page" : undefined}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${f.on ? "border-brand-400 bg-brand-50 text-brand-700" : "border-line bg-surface text-text-muted hover:bg-canvas"}`}
              >
                {f.label}
              </Link>
            ))
          : null}
        {!atama ? <span className="ml-auto text-xs text-text-muted">{total} kayıt{total > LIMIT ? ` · ilk ${LIMIT}` : ""}</span> : null}
      </nav>

      {atama ? (
        <AssignmentSection ctx={{ supabase, tenantId, userId, role, nowMs, canEdit: canAssign, view: atama }} />
      ) : entries.length === 0 ? (
        <EmptyState
          illustration="portfoy"
          icon={Layers}
          title={durum === "atanan" ? "Son 7 günde havuzdan atama yok" : enabled ? "Havuzda bekleyen ilan yok" : "İlan havuzu kapalı"}
          description={
            enabled
              ? "Yeni ilanlar havuza düştüğünde burada uzmanlığa göre önerilerle listelenir."
              : "Açıldığında atanmamış ve içe aktarılan ilanlar önce burada toplanır; kapalıyken mevcut portföy akışı değişmez."
          }
          tone="brand"
          action={{ href: "/app/portfoyler/yeni", label: "Yeni portföy ekle" }}
        />
      ) : (
        <ul className="space-y-4">
          {entries.map((e) => {
            const id = s(e.id);
            const p = props.get(s(e.property_id));
            const title = p ? s(p.title) || s(p.property_code) || "İlan" : "İlan";
            const place = p ? [nb.get(s(p.neighborhood_id)), ds.get(s(p.district_id)), pv.get(s(p.province_id))].filter(Boolean).join(", ") : "";
            const dueMs = s(e.sla_due_at) ? Date.parse(s(e.sla_due_at)) : null;
            const claimMs = s(e.claim_open_until) ? Date.parse(s(e.claim_open_until)) : null;
            const pending = s(e.status) === "pending";
            const state = pending ? slaState({ dueMs, createdMs: Date.parse(s(e.created_at)), nowMs }) : "none";
            const claimOpen = pending && isClaimOpen(claimMs, nowMs);
            const ageHours = Math.floor(msSince(s(e.created_at)) / 3_600_000);

            let panelSuggestions: PanelSuggestion[] = [];
            if (pending && candidateBundle && p) {
              const ranked: PoolSuggestion[] = rankCandidates(candidateBundle.candidates, toPoolProperty(p), {
                nowMs,
                officeAvgOpen: candidateBundle.officeAvgOpen,
                labels: { neighborhood: nb.get(s(p.neighborhood_id)), district: ds.get(s(p.district_id)), province: pv.get(s(p.province_id)) },
              });
              panelSuggestions = ranked.map((r) => ({
                profileId: r.profileId,
                name: r.name,
                score: r.score,
                reasons: r.reasons,
                excludedReason: r.excluded?.reason,
              }));
            }
            const history = eventsBy.get(id) ?? [];
            const assignedName = s(e.assigned_to) ? names.get(s(e.assigned_to)) : null;

            return (
              <li key={id} className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/app/portfoyler/${s(e.property_id)}`} className="font-display font-bold text-ink-950 hover:text-brand-600">
                      {title}
                    </Link>
                    <p className="mt-0.5 text-xs text-text-muted">
                      {[p ? s(p.transaction_type) : "", p ? s(p.property_type) : "", place].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    {p && p.list_price != null ? <span className="numeric font-semibold text-ink-950">{formatTry(Number(p.list_price))}</span> : null}
                    <span className="rounded-full bg-canvas px-2 py-0.5 font-semibold text-text-muted">{SOURCE_LABELS[s(e.source)] ?? s(e.source)}</span>
                    {pending ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-canvas px-2 py-0.5 font-semibold text-text-muted">
                        <Clock className="h-3 w-3" /> {ageHours < 1 ? "az önce" : ageHours < 48 ? `${ageHours} saattir` : `${Math.floor(ageHours / 24)} gündür`} bekliyor
                      </span>
                    ) : null}
                    {state !== "none" ? (
                      <span className={`rounded-full px-2 py-0.5 font-semibold ${slaTone(state)}`}>
                        {state === "breached" ? "SLA aşıldı" : state === "due_soon" ? "SLA yaklaşıyor" : "SLA içinde"}
                        {dueMs ? ` · ${dtf.format(dueMs)}` : ""}
                      </span>
                    ) : null}
                    {claimOpen && claimMs ? <span className="rounded-full bg-brand-50 px-2 py-0.5 font-semibold text-brand-700">Sahiplenme {dtf.format(claimMs)} dek</span> : null}
                  </div>
                </div>

                <div className="mt-4">
                  {pending ? (
                    <PoolEntryPanel
                      entryId={id}
                      mode={rule.mode}
                      canManage={canManage}
                      claimOpen={claimOpen}
                      suggestions={panelSuggestions}
                    />
                  ) : (
                    <p className="text-sm text-text-muted">
                      <span className="font-semibold text-ink-950">{assignedName ?? "Danışman"}</span> atandı
                      {s(e.assign_method) ? ` (${s(e.assign_method)})` : ""}
                      {s(e.assigned_at) ? ` · ${dtf.format(Date.parse(s(e.assigned_at)))}` : ""}
                    </p>
                  )}
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
    </ListPage>
  );
}
