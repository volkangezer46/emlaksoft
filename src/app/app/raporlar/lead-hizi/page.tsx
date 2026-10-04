import Link from "next/link";
import { AlarmClock, CheckCircle2, Hourglass, Timer, Users } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { StatCard } from "@/components/app/stat-card";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { daysAgoIso, now } from "@/lib/clock";
import { hasOfficeWideDataScope } from "@/lib/team/assignable-roles";
import {
  DEFAULT_SLA_MIN,
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

export const metadata = { title: "Lead Hızı" };

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
  bekliyor_gec: { label: "Yanıtsız · gecikti", cls: "bg-danger-500/10 text-danger-600" },
  bekliyor: { label: "Yanıt bekliyor", cls: "bg-amber-400/15 text-amber-600" },
  gecikti: { label: "Geç yanıtlandı", cls: "bg-amber-400/15 text-amber-600" },
  hizli: { label: "Süresinde", cls: "bg-mint-500/12 text-mint-600" },
};

const LIST_LIMIT = 60;

type Sp = { donem?: string; esik?: string; durum?: string; danisman?: string };

function href(sp: { donem: string; esik: number; durum?: string; danisman?: string }): string {
  const q = new URLSearchParams();
  if (sp.donem !== "30") q.set("donem", sp.donem);
  if (sp.esik !== DEFAULT_SLA_MIN) q.set("esik", String(sp.esik));
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
  const esikParsed = Number(sp.esik);
  const esik = (SLA_OPTIONS_MIN as readonly number[]).includes(esikParsed) ? esikParsed : DEFAULT_SLA_MIN;
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
        eyebrow="Raporlar"
        title="Lead Hızı"
        description={`Yeni müşteri kaydından ilk temasa geçen süre. Yalnız çalışma saatleri sayılır (Pzt-Cmt ${String(WORK_START_HOUR).padStart(2, "0")}:00-${WORK_END_HOUR}:00); gece ve pazar gelen talep sabah saatinde başlar. Not kayıtları temas sayılmaz.`}
      />

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Süzgeçler">
        {DONEM_FILTERS.map((f) => (
          <Link
            key={f.key}
            href={href({ ...base, donem: f.key, durum: sp.durum })}
            aria-current={f.key === donem.key ? "true" : undefined}
            className={`focus-ring press rounded-full border px-3 py-1.5 text-xs font-semibold transition ${f.key === donem.key ? "border-brand-600 bg-brand-600/10 text-brand-700" : "border-line bg-surface text-text-muted hover:border-brand-300"}`}
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
            className={`focus-ring press rounded-full border px-3 py-1.5 text-xs font-semibold transition ${m === esik ? "border-brand-600 bg-brand-600/10 text-brand-700" : "border-line bg-surface text-text-muted hover:border-brand-300"}`}
          >
            {formatMinutes(m)}
          </Link>
        ))}
      </div>

      {res.failed ? (
        <p className="rounded-[var(--radius-control)] border border-danger-500/30 bg-danger-500/8 px-3.5 py-3 text-sm text-danger-600" role="alert">
          Veriler okunurken hata oluştu; aşağıdaki sayılara güvenmeyin. Sayfayı yenileyin.
        </p>
      ) : res.partial ? (
        <p className="rounded-[var(--radius-control)] border border-amber-400/40 bg-amber-400/10 px-3.5 py-3 text-sm text-amber-700" role="status">
          Kayıt sayısı tarama sınırına ulaştı; sayılar eksik olabilir. Pencereyi daraltın.
        </p>
      ) : null}

      <section aria-label="Özet" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
      </section>

      {officeWide ? (
        <section aria-label="Danışman görünümü" className="rounded-[var(--radius-panel)] border border-line bg-surface shadow-[var(--shadow-xs)]">
          <h2 className="flex items-center gap-2 border-b border-line px-4 py-3 text-sm font-bold text-ink-950">
            <Users className="h-4 w-4 text-brand-600" /> Danışman bazında
          </h2>
          {byAdvisor.length === 0 ? (
            <p className="px-4 py-6 text-sm text-text-muted">Bu pencerede yeni müşteri kaydı yok.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="text-left text-xs text-text-faint">
                    <th scope="col" className="px-4 py-2 font-semibold">Danışman</th>
                    <th scope="col" className="px-3 py-2 font-semibold">Yeni kayıt</th>
                    <th scope="col" className="px-3 py-2 font-semibold">Ort. yanıt</th>
                    <th scope="col" className="px-3 py-2 font-semibold">Süresinde</th>
                    <th scope="col" className="px-3 py-2 font-semibold">Gecikmiş</th>
                  </tr>
                </thead>
                <tbody>
                  {byAdvisor.map((a) => {
                    const key = a.advisorId ?? "atanmamis";
                    return (
                      <tr key={key} className="border-t border-line">
                        <td className="px-4 py-2.5 font-semibold text-ink-950">
                          <Link
                            href={href({ ...base, danisman: key, durum: sp.durum })}
                            className="focus-ring rounded hover:text-brand-600"
                          >
                            {advisorName(a.advisorId)}
                          </Link>
                        </td>
                        <td className="px-3 py-2.5 text-text-muted">{a.summary.total}</td>
                        <td className="px-3 py-2.5 text-text-muted">{formatMinutes(a.summary.avgMin)}</td>
                        <td className="px-3 py-2.5 text-text-muted">
                          {a.summary.withinSlaPct === null ? "Veri yok" : `%${a.summary.withinSlaPct}`}
                        </td>
                        <td className="px-3 py-2.5">
                          {a.summary.overdueWaiting > 0 ? (
                            <Link
                              href={href({ ...base, danisman: key, durum: "gecikmis" })}
                              className="focus-ring rounded font-semibold text-danger-600 hover:underline"
                            >
                              {a.summary.overdueWaiting}
                            </Link>
                          ) : (
                            <span className="text-text-faint">0</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {danismanFilter ? (
            <p className="border-t border-line px-4 py-2 text-xs text-text-muted">
              Liste {advisorName(danismanFilter === "atanmamis" ? null : danismanFilter)} ile sınırlı.{" "}
              <Link href={href({ ...base, danisman: undefined, durum: sp.durum })} className="font-semibold text-brand-600 hover:underline">
                Süzgeci kaldır
              </Link>
            </p>
          ) : null}
        </section>
      ) : null}

      <section aria-label="Kayıt listesi" className="rounded-[var(--radius-panel)] border border-line bg-surface shadow-[var(--shadow-xs)]">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <h2 className="mr-2 text-sm font-bold text-ink-950">Kayıtlar</h2>
          {DURUM_FILTERS.map((f) => (
            <Link
              key={f.key}
              href={href({ ...base, durum: f.key })}
              aria-current={f.key === durum.key ? "true" : undefined}
              className={`focus-ring press rounded-full border px-3 py-1 text-xs font-semibold transition ${f.key === durum.key ? "border-brand-600 bg-brand-600/10 text-brand-700" : "border-line bg-surface text-text-muted hover:border-brand-300"}`}
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
                <li key={r.customerId} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
                  <Link
                    href={`/app/musteriler/${r.customerId}`}
                    className="focus-ring min-w-0 flex-1 truncate rounded text-sm font-semibold text-ink-950 hover:text-brand-600"
                  >
                    {r.name}
                  </Link>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${badge.cls}`}>{badge.label}</span>
                  <span className="text-xs text-text-muted">
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
