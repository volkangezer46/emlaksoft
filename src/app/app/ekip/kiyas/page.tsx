import Link from "next/link";
import { ArrowLeftRight, Info, Trophy, UsersRound } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { now } from "@/lib/clock";
import { PageHeader } from "@/components/ui/page-header";
import { StatRow } from "@/components/ui/stat-row";
import { Table, TableFrame, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState } from "@/components/app/empty-state";
import { ListLimitNotice } from "@/components/app/list-limit-notice";
import { canSeeAllEarnings } from "@/lib/team/earnings-scope";
import { OPEN_DEMAND_STATUSES, attentionReasons, untrackedCustomerIds } from "@/lib/team/advisor-360";
import {
  SCORECARD_FILTERS,
  SCORECARD_SORTS,
  buildScorecard,
  matchesScorecardFilter,
  parseScorecardFilter,
  parseScorecardSort,
  trMonthContext,
  type ScorecardInput,
} from "@/lib/team/scorecard";

const ROLE_LABELS: Record<string, string> = {
  owner: "Ofis sahibi",
  gm: "Genel müdür",
  branch_manager: "Şube müdürü",
  team_lead: "Takım lideri",
  advisor: "Danışman",
};
const SCORED_ROLES = Object.keys(ROLE_LABELS);
const PROFILE_LIMIT = 200;
const SCAN_LIMIT = 5000;

function money(n: number) {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(n);
}

type SearchParams = { sirala?: string; filtre?: string };

const LINK =
  "focus-ring relative z-10 rounded-[var(--radius-control)] hover:text-brand-600 hover:underline";

export default async function TeamBenchmarkPage({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const { tenantId, userId, perms } = await requireModulePage("reports", "/app/ekip/kiyas");
  const canHandoff = (perms.team ?? []).includes("edit");
  const seeAllEarnings = canSeeAllEarnings(perms);
  const sp = (await searchParams) ?? {};
  const sort = parseScorecardSort(sp.sirala, seeAllEarnings);
  const filter = parseScorecardFilter(sp.filtre);

  const { monthKey, monthStartIso, elapsedPct } = trMonthContext(now());
  const supabase = await createClient();

  const [profilesRes, kpiRes, targetsRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, role", { count: "exact" })
      .eq("is_active", true)
      .in("role", SCORED_ROLES)
      .order("full_name")
      .limit(PROFILE_LIMIT),
    tenantId
      ? supabase.rpc("advisor_kpis", { p_tenant_id: tenantId, p_month_start: monthStartIso })
      : Promise.resolve({ data: [] as Array<Record<string, unknown>>, error: null }),
    supabase
      .from("targets")
      .select("profile_id, target_deals, target_revenue")
      .eq("period", "monthly")
      .eq("period_start", monthKey)
      .not("profile_id", "is", null),
  ]);

  const loadFailed = Boolean(profilesRes.error || kpiRes.error);
  const profiles = (profilesRes.data ?? []) as { id: string; full_name: string; role: string }[];

  const kpiById = new Map<string, Record<string, unknown>>();
  for (const r of (kpiRes.data ?? []) as Array<Record<string, unknown>>) kpiById.set(String(r.assigned_to), r);

  // Yayındaki portföy sayısı: eskiden 5000 satır çekilip bellekte sayılıyordu (yavaş sekme, QA #6).
  // Ekip küçük/orta ise üye başına tek "head count" (satır taşımaz) paralel koşar; çok büyük ekipte tek taramaya düşer.
  const propsById = new Map<string, number>();
  const LIVE = ["live", "Yayında"];
  if (profiles.length <= 80) {
    const counts = await Promise.all(
      profiles.map((p) =>
        supabase
          .from("properties")
          .select("id", { count: "exact", head: true })
          .is("deleted_at", null)
          .in("status", LIVE)
          .eq("assigned_to", p.id)
          .then((r) => [p.id, r.count ?? 0] as const),
      ),
    );
    for (const [id, n] of counts) if (n > 0) propsById.set(id, n);
  } else {
    const { data: propRows } = await supabase
      .from("properties")
      .select("assigned_to")
      .is("deleted_at", null)
      .in("status", LIVE)
      .not("assigned_to", "is", null)
      .limit(5000);
    for (const r of (propRows ?? []) as { assigned_to: string | null }[]) {
      if (r.assigned_to) propsById.set(r.assigned_to, (propsById.get(r.assigned_to) ?? 0) + 1);
    }
  }

  // Aktif talep + öncül uyarılar: tek taramayla tüm danışmanlar (tavana dayanırsa gösterilmez, sahte sayı yok).
  const [demandRes, taskRes] = await Promise.all([
    supabase
      .from("customer_demands")
      .select("customer_id, customer:customers!customer_demands_customer_id_fkey!inner(assigned_to)")
      .in("status", [...OPEN_DEMAND_STATUSES])
      .not("customer.assigned_to", "is", null)
      .limit(SCAN_LIMIT),
    supabase
      .from("tasks")
      .select("assigned_to, customer_id, due_at")
      .eq("status", "open")
      .not("assigned_to", "is", null)
      .limit(SCAN_LIMIT),
  ]);
  const demandRows = (demandRes.data ?? []) as unknown as {
    customer_id: string | null;
    customer: { assigned_to: string | null } | { assigned_to: string | null }[] | null;
  }[];
  const taskRows = (taskRes.data ?? []) as { assigned_to: string; customer_id: string | null; due_at: string | null }[];
  const leadPartial = Boolean(
    demandRes.error || taskRes.error || demandRows.length >= SCAN_LIMIT || taskRows.length >= SCAN_LIMIT,
  );
  const nowMs = now();
  const demandsByAdvisor = new Map<string, (string | null)[]>();
  for (const d of demandRows) {
    const owner = (Array.isArray(d.customer) ? d.customer[0] : d.customer)?.assigned_to;
    if (!owner) continue;
    const list = demandsByAdvisor.get(owner) ?? [];
    list.push(d.customer_id);
    demandsByAdvisor.set(owner, list);
  }
  const tasksByAdvisor = new Map<string, { customer_id: string | null; due_at: string | null }[]>();
  for (const t of taskRows) {
    const list = tasksByAdvisor.get(t.assigned_to) ?? [];
    list.push(t);
    tasksByAdvisor.set(t.assigned_to, list);
  }
  const leadById = new Map<string, { activeDemands: number | null; overdue: number | null; untracked: number | null }>();
  for (const p of profiles) {
    const demands = demandsByAdvisor.get(p.id) ?? [];
    const tasks = tasksByAdvisor.get(p.id) ?? [];
    leadById.set(p.id, {
      activeDemands: leadPartial ? null : demands.length,
      overdue: leadPartial ? null : tasks.filter((t) => t.due_at && Date.parse(t.due_at) < nowMs).length,
      untracked: leadPartial
        ? null
        : untrackedCustomerIds(demands, tasks.map((t) => t.customer_id)).length,
    });
  }

  const targetById = new Map<string, { deals: number; revenue: number }>();
  for (const t of (targetsRes.data ?? []) as { profile_id: string | null; target_deals: number; target_revenue: number }[]) {
    if (t.profile_id) targetById.set(t.profile_id, { deals: Number(t.target_deals) || 0, revenue: Number(t.target_revenue) || 0 });
  }

  const inputs: ScorecardInput[] = profiles.map((p) => {
    const k = kpiById.get(p.id);
    return {
      id: p.id,
      fullName: p.full_name,
      role: p.role,
      customerCount: Number(k?.customer_count ?? 0),
      activePropertyCount: propsById.get(p.id) ?? 0,
      callCount: Number(k?.call_count ?? 0),
      appointCount: Number(k?.appoint_count ?? 0),
      offerCount: Number(k?.offer_count ?? 0),
      dealCount: Number(k?.deal_count ?? 0),
      revenue: Number(k?.revenue ?? 0),
      target: targetById.get(p.id) ?? null,
    };
  });

  const includeRevenue = (id: string) => seeAllEarnings || id === userId;
  const all = buildScorecard(inputs, sort, { includeRevenueInTarget: includeRevenue });
  const rows = filter ? all.filter((r) => matchesScorecardFilter(r, filter, elapsedPct)) : all;

  const href = (patch: SearchParams) => {
    const q = new URLSearchParams();
    const next = { sirala: sp.sirala, filtre: sp.filtre, ...patch };
    if (next.sirala) q.set("sirala", next.sirala);
    if (next.filtre) q.set("filtre", next.filtre);
    const s = q.toString();
    return s ? `/app/ekip/kiyas?${s}` : "/app/ekip/kiyas";
  };

  const monthLabel = new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric", timeZone: "Europe/Istanbul" }).format(
    new Date(now()),
  );
  const counts = {
    randevusuz: all.filter((r) => matchesScorecardFilter(r, "randevusuz", elapsedPct)).length,
    portfoysuz: all.filter((r) => matchesScorecardFilter(r, "portfoysuz", elapsedPct)).length,
    hedefgeride: all.filter((r) => matchesScorecardFilter(r, "hedefgeride", elapsedPct)).length,
  };
  const needAttention = all
    .map((r) => {
      const l = leadById.get(r.id);
      return { r, reasons: attentionReasons({ overdueTasks: l?.overdue ?? null, untrackedDemands: l?.untracked ?? null }) };
    })
    .filter((x) => x.reasons.length > 0);
  const hasAnyActivity = all.some((r) => r.callCount + r.appointCount + r.offerCount + r.dealCount + r.activePropertyCount > 0);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Ekip Merkezi"
        title="Danışman kıyası"
        description={`${monthLabel} dönemi karnesi. Ölçümler mevcut çağrı, randevu, teklif, anlaşma, portföy ve hedef kayıtlarından gelir; uydurma skor yoktur.`}
        actions={
          <>
            <Link
              href="/app/danisman-kpi"
              className="focus-ring press inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-text-muted transition hover:border-line-strong hover:text-text"
            >
              <UsersRound className="h-3.5 w-3.5" aria-hidden /> Aylık karne ve geçmiş aylar
            </Link>
            <Link
              href="/app/lig"
              className="focus-ring press inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-text-muted transition hover:border-line-strong hover:text-text"
            >
              <Trophy className="h-3.5 w-3.5" aria-hidden /> Ekip ligi
            </Link>
          </>
        }
      />

      {loadFailed ? (
        <EmptyState
          icon={Info}
          tone="danger"
          illustration="error"
          title="Karne yüklenemedi"
          description="Danışman verileri şu an okunamadı. Sayfayı yenileyin; sorun sürerse destek ile iletişime geçin."
          action={{ href: "/app/destek", label: "Destek" }}
        />
      ) : all.length === 0 ? (
        <EmptyState
          icon={UsersRound}
          illustration="start"
          title="Kıyaslanacak danışman yok"
          description="Ofise danışman davet ettiğinizde çağrı, randevu, teklif ve anlaşma ölçümleri burada karşılaştırılır."
          action={{ href: "/app/ekip", label: "Ekibe danışman ekle" }}
        />
      ) : (
        <>
          <StatRow
            label="Dikkat gerektiren danışmanlar"
            items={SCORECARD_FILTERS.map((f) => ({
              label: f.label,
              value: counts[f.value],
              href: href({ filtre: filter === f.value ? undefined : f.value }),
              attention: counts[f.value] > 0,
              hint: filter === f.value ? "filtre açık" : "listeyi daralt",
            }))}
          />

          {needAttention.length > 0 ? (
            <section aria-label="Takip uyarıları" className="rounded-[var(--radius-card)] border border-danger-500/30 bg-danger-500/[0.05] p-4">
              <h2 className="text-sm font-bold text-ink-950">Takip uyarısı: {needAttention.length} danışman ilgi bekliyor</h2>
              <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
                {needAttention.map(({ r, reasons }) => (
                  <li key={r.id}>
                    <Link
                      href={`/app/ekip/${r.id}?sekme=oncul`}
                      className="focus-ring flex items-center justify-between gap-3 rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2 text-sm transition hover:border-brand-400"
                    >
                      <span className="font-semibold text-ink-950">{r.fullName}</span>
                      <span className="text-xs text-danger-600">{reasons.join(" · ")}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <nav aria-label="Sıralama" className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-semibold text-text-muted">Sırala:</span>
            {SCORECARD_SORTS.filter((s) => s.value !== "kazanc" || seeAllEarnings).map((s) => (
              <Link
                key={s.value}
                href={href({ sirala: s.value === "anlasma" ? undefined : s.value })}
                aria-current={sort === s.value ? "true" : undefined}
                className={`focus-ring rounded-full border px-3 py-1 font-semibold transition ${
                  sort === s.value
                    ? "border-brand-600 bg-brand-600/10 text-brand-700"
                    : "border-line text-text-muted hover:border-line-strong hover:text-text"
                }`}
              >
                {s.label}
              </Link>
            ))}
            {filter ? (
              <Link href={href({ filtre: undefined })} className="focus-ring ml-auto rounded-full px-3 py-1 font-semibold text-brand-700 hover:underline">
                Filtreyi temizle
              </Link>
            ) : null}
          </nav>

          <ListLimitNotice shown={profiles.length} total={profilesRes.count} hint="Şubeye göre daraltmak için Ekip sayfasını kullanın." />

          {!hasAnyActivity ? (
            <p className="rounded-[var(--radius-card)] border border-line bg-canvas px-4 py-3 text-sm text-text-muted">
              Bu ay henüz çağrı, randevu, teklif veya anlaşma kaydı yok; sıralama veri geldikçe oluşur.
            </p>
          ) : null}

          {rows.length === 0 ? (
            <EmptyState
              icon={UsersRound}
              illustration="search"
              title="Bu filtreye uyan danışman yok"
              description="Seçili ölçüte uyan danışman bulunmuyor. Filtreyi kaldırarak tüm ekibi görebilirsiniz."
              action={{ href: href({ filtre: undefined }), label: "Filtreyi temizle" }}
            />
          ) : (
            <TableFrame minWidth={960}>
              <Table>
                <THead>
                  <TR>
                    <TH>#</TH>
                    <TH>Danışman</TH>
                    <TH align="right">Müşteri</TH>
                    <TH align="right">Yayında portföy</TH>
                    <TH align="right">Aktif talep</TH>
                    <TH align="right">Randevu</TH>
                    <TH align="right">Teklif</TH>
                    <TH align="right">Anlaşma</TH>
                    <TH align="right">Dönüşüm</TH>
                    <TH align="right">Kazanç</TH>
                    <TH align="right">Hedef</TH>
                    {canHandoff ? <TH align="right">İşlem</TH> : null}
                  </TR>
                </THead>
                <TBody>
                  {rows.map((r) => (
                    <TR key={r.id}>
                      <TD className="text-text-faint">{r.rank > 0 ? r.rank : "—"}</TD>
                      <TD>
                        <Link href={`/app/ekip/${r.id}`} className={`${LINK} font-semibold text-ink-950`}>
                          {r.fullName}
                        </Link>
                        <p className="text-xs text-text-faint">{ROLE_LABELS[r.role] ?? r.role}</p>
                      </TD>
                      <TD align="right">
                        <Link href={`/app/musteriler?assigned=${r.id}`} className={LINK} aria-label={`${r.fullName} müşterileri`}>
                          {r.customerCount}
                        </Link>
                      </TD>
                      <TD align="right">
                        <Link
                          href={`/app/portfoyler?status=live&danisman=${r.id}`}
                          className={LINK}
                          aria-label={`${r.fullName} yayındaki portföyleri`}
                        >
                          {r.activePropertyCount}
                        </Link>
                      </TD>
                      <TD align="right">
                        {leadById.get(r.id)?.activeDemands == null ? (
                          <span className="text-text-faint" title="Tarama sınırı aşıldı">—</span>
                        ) : (
                          <Link href={`/app/talepler?danisman=${r.id}`} className={LINK} aria-label={`${r.fullName} aktif talepleri`}>
                            {leadById.get(r.id)?.activeDemands}
                          </Link>
                        )}
                      </TD>
                      <TD align="right">
                        <Link href={`/app/randevular?danisman=${r.id}`} className={LINK} aria-label={`${r.fullName} randevuları`}>
                          {r.appointCount}
                        </Link>
                      </TD>
                      <TD align="right">
                        <Link href={`/app/teklifler?danisman=${r.id}`} className={LINK} aria-label={`${r.fullName} teklifleri`}>
                          {r.offerCount}
                        </Link>
                      </TD>
                      <TD align="right" className="font-semibold text-ink-950">
                        <Link href={`/app/teklifler?danisman=${r.id}&durum=accepted`} className={LINK} aria-label={`${r.fullName} kabul edilen teklifleri`}>
                          {r.dealCount}
                        </Link>
                      </TD>
                      <TD align="right" className="text-text-muted">
                        {r.conversionPct === null ? "—" : `%${r.conversionPct}`}
                      </TD>
                      <TD align="right" className="font-bold text-mint-700">
                        {includeRevenue(r.id) ? (
                          <Link href={r.id === userId ? "/app/cuzdan" : `/app/ekip/${r.id}`} className={LINK}>
                            {r.revenue > 0 ? money(r.revenue) : "—"}
                          </Link>
                        ) : (
                          <span title="Başkasının kazancını görme izniniz yok" className="text-text-faint">Gizli</span>
                        )}
                      </TD>
                      <TD align="right">
                        {r.targetPct === null ? (
                          <Link href="/app/hedefler" className={`${LINK} text-xs text-text-faint`}>
                            Hedef yok
                          </Link>
                        ) : (
                          <Link href="/app/hedefler" className={LINK} aria-label={`${r.fullName} hedef gerçekleşmesi`}>
                            %{r.targetPct}
                          </Link>
                        )}
                      </TD>
                      {canHandoff ? (
                        <TD align="right">
                          <Link
                            href={`/app/ekip/devir?from=${r.id}`}
                            className={`${LINK} inline-flex items-center gap-1 text-xs font-semibold text-text-muted`}
                          >
                            <ArrowLeftRight className="h-3 w-3" aria-hidden /> Devret
                          </Link>
                        </TD>
                      ) : null}
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableFrame>
          )}
          <p className="text-xs text-text-faint">
            Dönüşüm = anlaşma / teklif. Hedef gerçekleşmesi canlı verilerden hesaplanır (anlaşma ve tahsil edilen komisyon).
            Kıyas bu ayı kapsar; geçmiş aylar için aylık karneyi kullanın.
          </p>
        </>
      )}
    </div>
  );
}
