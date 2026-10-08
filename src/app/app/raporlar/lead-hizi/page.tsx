import { KpiGrid } from "@/components/ui/dashboard-grid";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import Link from "@/components/ui/smart-link";
import { AlarmClock, CheckCircle2, Hourglass, Timer, Users } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { PrintButton } from "@/components/ui/print-button";
import { Progress } from "@/components/ui/progress";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/app/stat-card";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { daysAgoIso, now } from "@/lib/clock";
import { hasOfficeWideDataScope } from "@/lib/team/assignable-roles";
import { getSetting } from "@/lib/settings/read";
import {
  formatMinutes,
  SLA_OPTIONS_MIN,
  summarizeByAdvisor,
  summarizeResponses,
  WORK_END_HOUR,
  WORK_START_HOUR,
  type LeadResponse,
  type LeadResponseStatus,
} from "@/lib/response-time/core";
import { loadLeadResponses } from "@/lib/response-time/load";

export const metadata = { title: "Aday Hızı" };

/** ?donem= kontratı — kayıt açılış penceresi (gün). */
const DONEM_FILTERS = [
  { key: "7", days: 7, label: "Son 7 gün" },
  { key: "30", days: 30, label: "Son 30 gün" },
  { key: "90", days: 90, label: "Son 90 gün" },
] as const;

/** ?durum= kontratı — liste süzgeci. */
const DURUM_FILTERS: readonly { key: string; label: string; match: LeadResponseStatus[] }[] = [
  { key: "gecikmis", label: "Yanıtsız ve gecikmiş", match: ["bekliyor_gec"] },
  { key: "bekliyor", label: "Yanıt bekleyen (süre içinde)", match: ["bekliyor"] },
  { key: "gec", label: "Geç yanıtlanan", match: ["gecikti"] },
  { key: "hizli", label: "Süresinde yanıtlanan", match: ["hizli"] },
  { key: "tumu", label: "Tümü", match: ["bekliyor_gec", "bekliyor", "gecikti", "hizli"] },
];

const STATUS_BADGE: Record<LeadResponseStatus, { label: string; cls: string }> = {
  bekliyor_gec: { label: "Yanıtsız · gecikti", cls: "bg-[color-mix(in_srgb,var(--viz-neg)_12%,transparent)] text-[color:var(--viz-neg)]" },
  bekliyor: { label: "Yanıt bekliyor", cls: "bg-[color-mix(in_srgb,var(--viz-5)_14%,transparent)] text-[color:var(--pm-warn-text)]" },
  gecikti: { label: "Geç yanıtlandı", cls: "bg-[color-mix(in_srgb,var(--viz-5)_14%,transparent)] text-[color:var(--pm-warn-text)]" },
  hizli: { label: "Süresinde", cls: "bg-[color-mix(in_srgb,var(--viz-pos)_13%,transparent)] text-[color:var(--viz-pos)]" },
};

const LIST_LIMIT = 60;

type Sp = { donem?: string; esik?: string; durum?: string; danisman?: string };

function href(sp: { donem: string; esik: number; durum?: string; danisman?: string }): string {
  const q = new URLSearchParams();
  if (sp.donem !== "30") q.set("donem", sp.donem);
  // Ofis varsayılanı değişebildiği için eşik URL'de her zaman taşınır (paylaşılan bağlantı aynı sonucu verir).
  q.set("esik", String(sp.esik));
  if (sp.durum) q.set("durum", sp.durum);
  if (sp.danisman) q.set("danisman", sp.danisman);
  const s = q.toString();
  return `/app/raporlar/lead-hizi${s ? `?${s}` : ""}`;
}

export default async function LeadSpeedPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const { userId, role, tenantId } = await requireModulePage("reports", "/app/raporlar");
  const sp = await searchParams;
  const supabase = await createClient();

  const donem = DONEM_FILTERS.find((f) => f.key === sp.donem) ?? DONEM_FILTERS[1];
  // Ofis Tanımları Merkezi: ilk yanıt SLA varsayılanı (ayar yoksa kod varsayılanı 60 dk).
  const officeSla = Number(await getSetting<string>("office.sla.lead_first_response_min", { tenantId: tenantId ?? undefined }));
  const esikParsed = Number(sp.esik);
  const esik = (SLA_OPTIONS_MIN as readonly number[]).includes(esikParsed) ? esikParsed : officeSla;
  const durum = DURUM_FILTERS.find((f) => f.key === sp.durum) ?? DURUM_FILTERS[0];
  const officeWide = hasOfficeWideDataScope(role);
  const danismanFilter = officeWide ? (sp.danisman ?? "").trim() || null : null;

  const nowMs = now();
  const res = await loadLeadResponses(supabase, {
    tenantId,
    startIso: daysAgoIso(donem.days),
    endIso: new Date(nowMs + 60_000).toISOString(),
    assignedToIn: officeWide ? null : [userId],
    slaMin: esik,
    nowMs,
  });

  const scoped: LeadResponse[] = danismanFilter
    ? res.rows.filter((r) => (danismanFilter === "atanmamis" ? r.assignedTo === null : r.assignedTo === danismanFilter))
    : res.rows;
  const overall = summarizeResponses(scoped);
  const byAdvisor = summarizeByAdvisor(res.rows);

  const advisorIds = byAdvisor.map((a) => a.advisorId).filter((id): id is string => !!id);
  const { data: profiles } = advisorIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", advisorIds)
    : { data: [] as { id: string; full_name: string }[] };
  const nameOf = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));
  const advisorName = (id: string | null) => (id ? (nameOf.get(id) ?? "Danışman") : "Atanmamış");

  const list = scoped
    .filter((r) => durum.match.includes(r.status))
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, LIST_LIMIT);
  const listTotal = scoped.filter((r) => durum.match.includes(r.status)).length;

  const base = { donem: donem.key, esik, danisman: danismanFilter ?? undefined };
  return (
    <div className="space-y-6">
      <PageHeader
        actions={
          <span className="flex flex-wrap items-center gap-2">
            <PrintButton tone="outline" size="sm" />
          </span>
        }
        eyebrow="Raporlar"
        title="Aday Hızı"
        description={`Yeni müşteri kaydından ilk temasa geçen süre. Yalnız çalışma saatleri sayılır (Pzt-Cmt ${String(WORK_START_HOUR).padStart(2, "0")}:00-${WORK_END_HOUR}:00); gece ve pazar gelen talep sabah saatinde başlar. Not kayıtları temas sayılmaz.`}
      />

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Süzgeçler">
        {DONEM_FILTERS.map((f) => (
          <Link
            key={f.key}
            href={href({ ...base, donem: f.key, durum: sp.durum })}
            aria-current={f.key === donem.key ? "true" : undefined}
            className={`focus-ring press rounded-full border px-3 py-1.5 text-xs font-semibold transition ${f.key === donem.key ? "border-accent bg-accent-subtle text-accent-text" : "border-line bg-surface text-text-muted hover:border-border-interactive"}`}
          >
            {f.label}
          </Link>
        ))}
        <span className="mx-1 text-xs text-text-faint" aria-hidden="true">
          |
        </span>
        <span className="text-xs font-semibold text-text-muted">Hedef süre:</span>
        {SLA_OPTIONS_MIN.map((m) => (
          <Link
            key={m}
            href={href({ ...base, esik: m, durum: sp.durum })}
            aria-current={m === esik ? "true" : undefined}
            className={`focus-ring press rounded-full border px-3 py-1.5 text-xs font-semibold transition ${m === esik ? "border-accent bg-accent-subtle text-accent-text" : "border-line bg-surface text-text-muted hover:border-border-interactive"}`}
          >
            {formatMinutes(m)}
          </Link>
        ))}
      </div>

      {res.failed ? (
        <p className="rounded-[var(--radius-control)] border border-[color:var(--viz-neg)]/30 bg-[color-mix(in_srgb,var(--viz-neg)_8%,transparent)] px-3.5 py-3 text-sm text-[color:var(--viz-neg)]" role="alert">
          Veriler okunurken hata oluştu; aşağıdaki sayılara güvenmeyin. Sayfayı yenileyin.
        </p>
      ) : res.partial ? (
        <p className="rounded-[var(--radius-control)] border border-[color:var(--viz-5)]/40 bg-[color-mix(in_srgb,var(--viz-5)_10%,transparent)] px-3.5 py-3 text-sm text-[color:var(--pm-warn-text)]" role="status">
          Kayıt sayısı tarama sınırına ulaştı; sayılar eksik olabilir. Pencereyi daraltın.
        </p>
      ) : null}

      <KpiGrid label="Özet">
        <StatCard
          label="Ortalama ilk yanıt"
          value={formatMinutes(overall.avgMin)}
          icon={Timer}
          tone="brand"
          href={href({ ...base, durum: "tumu" })}
        />
        <StatCard
          label="Hedef süre içinde"
          value={overall.withinSlaPct === null ? "Veri yok" : `%${overall.withinSlaPct}`}
          icon={CheckCircle2}
          tone="success"
          href={href({ ...base, durum: "hizli" })}
        />
        <StatCard
          label="Yanıt bekleyen"
          value={overall.waiting}
          icon={Hourglass}
          tone="warning"
          href={href({ ...base, durum: "bekliyor" })}
        />
        <StatCard
          label="Gecikmiş (yanıtsız)"
          value={overall.overdueWaiting}
          icon={AlarmClock}
          tone={overall.overdueWaiting > 0 ? "danger" : "success"}
          href={href({ ...base, durum: "gecikmis" })}
        />
      </KpiGrid>

      {officeWide ? (
        <section aria-label="Danışman görünümü" className="surface-card rounded-[var(--radius-panel)]">
          <h2 className="flex items-center gap-2 border-b border-line px-4 py-3 text-sm font-bold text-text">
            <Users className="h-4 w-4 text-accent-text" /> Danışman bazında
          </h2>
          {byAdvisor.length === 0 ? (
            <p className="px-4 py-6 text-sm text-text-muted">Bu pencerede yeni müşteri kaydı yok.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table className="w-full min-w-[560px] text-sm">
                <THead>
                  <TR className="text-left text-xs text-text-faint">
                    <TH scope="col" className="px-4 py-2 font-semibold">Danışman</TH>
                    <TH scope="col" className="px-3 py-2 font-semibold">Yeni kayıt</TH>
                    <TH scope="col" className="px-3 py-2 font-semibold">Ort. yanıt</TH>
                    <TH scope="col" className="px-3 py-2 font-semibold">Süresinde</TH>
                    <TH scope="col" className="px-3 py-2 font-semibold">Gecikmiş</TH>
                  </TR>
                </THead>
                <TBody>
                  {byAdvisor.map((a) => {
                    const key = a.advisorId ?? "atanmamis";
                    return (
                      <TR key={key} className="border-t border-line">
                        <TD className="px-4 py-2 font-semibold text-text">
                          <Link
                            href={href({ ...base, danisman: key, durum: sp.durum })}
                            className="focus-ring rounded hover:text-accent-text"
                          >
                            {advisorName(a.advisorId)}
                          </Link>
                        </TD>
                        <TD className="px-3 py-2 tabular-nums text-text-muted">{a.summary.total}</TD>
                        <TD className="px-3 py-2 tabular-nums text-text-muted">{formatMinutes(a.summary.avgMin)}</TD>
                        <TD className="px-3 py-2 tabular-nums text-text-muted">
                          {a.summary.withinSlaPct === null ? (
                            "Veri yok"
                          ) : (
                            <span className="flex min-w-24 flex-col gap-1">
                              <span>%{a.summary.withinSlaPct}</span>
                              <Progress
                                value={a.summary.withinSlaPct}
                                label={`${advisorName(a.advisorId)} hedef süre içinde`}
                                tone={a.summary.withinSlaPct >= 80 ? "success" : a.summary.withinSlaPct >= 50 ? "warning" : "danger"}
                              />
                            </span>
                          )}
                        </TD>
                        <TD className="px-3 py-2">
                          {a.summary.overdueWaiting > 0 ? (
                            <Link
                              href={href({ ...base, danisman: key, durum: "gecikmis" })}
                              className="focus-ring rounded font-semibold text-[color:var(--viz-neg)] hover:underline"
                            >
                              {a.summary.overdueWaiting}
                            </Link>
                          ) : (
                            <span className="text-text-faint">0</span>
                          )}
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </div>
          )}
          {danismanFilter ? (
            <p className="border-t border-line px-4 py-2 text-xs text-text-muted">
              Liste {advisorName(danismanFilter === "atanmamis" ? null : danismanFilter)} ile sınırlı.{" "}
              <Link href={href({ ...base, danisman: undefined, durum: sp.durum })} className="font-semibold text-accent-text hover:underline">
                Süzgeci kaldır
              </Link>
            </p>
          ) : null}
        </section>
      ) : null}

      <section aria-label="Kayıt listesi" className="surface-card rounded-[var(--radius-panel)]">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <h2 className="mr-2 text-sm font-bold text-text">Kayıtlar</h2>
          {DURUM_FILTERS.map((f) => (
            <Link
              key={f.key}
              href={href({ ...base, durum: f.key })}
              aria-current={f.key === durum.key ? "true" : undefined}
              className={`focus-ring press rounded-full border px-3 py-1 text-xs font-semibold transition ${f.key === durum.key ? "border-accent bg-accent-subtle text-accent-text" : "border-line bg-surface text-text-muted hover:border-border-interactive"}`}
            >
              {f.label}
            </Link>
          ))}
        </div>
        {list.length === 0 ? (
          <div className="p-4">
            <EmptyState
              variant="compact"
              icon={CheckCircle2}
              title={res.rows.length === 0 ? "Bu pencerede yeni müşteri kaydı yok" : "Bu süzgeçte kayıt yok"}
              description={
                res.rows.length === 0
                  ? "Yeni müşteri eklendiğinde ilk temas süresi burada ölçülür."
                  : "Süzgeci değiştirerek diğer kayıtlara bakabilirsiniz."
              }
            />
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {list.map((r) => {
              const badge = STATUS_BADGE[r.status];
              return (
                <li key={r.customerId} className="flex min-h-10 flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2">
                  <Link
                    href={`/app/musteriler/${r.customerId}`}
                    className="focus-ring min-w-0 flex-1 truncate rounded text-sm font-semibold text-text hover:text-accent-text"
                  >
                    {r.name}
                  </Link>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${badge.cls}`}>{badge.label}</span>
                  <span className="text-xs tabular-nums text-text-muted">
                    {r.responded ? "İlk yanıt" : "Bekleme"}: {formatMinutes(r.minutes)}
                  </span>
                  {officeWide ? <span className="text-xs text-text-faint">{advisorName(r.assignedTo)}</span> : null}
                </li>
              );
            })}
          </ul>
        )}
        {listTotal > list.length ? (
          <p className="border-t border-line px-4 py-2 text-xs text-text-muted">
            İlk {list.length} kayıt gösteriliyor ({listTotal} kayıt); en uzun bekleyen önce.
          </p>
        ) : null}
      </section>
    </div>
  );
}
