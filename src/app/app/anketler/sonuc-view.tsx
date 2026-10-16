import { dealTypeLabel } from "@/lib/deal-type-label";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { assertQueryBatchSucceeded } from "@/lib/supabase/query-batch";
import { Table, TableFrame, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { StatRow } from "@/components/ui/stat-row";
import Link from "@/components/ui/smart-link";
import {
  Gauge,
  Hourglass,
  MessageSquareQuote,
  Send,
  Smile,
  Star,
  Users,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/ui/empty-state";
import { getBaseUrl } from "@/lib/base-url";
import { CopySurveyLinkButton, CreateSurveyButton } from "./survey-actions";
import { formatDateTr, formatTry } from "@/lib/format";
import { effectiveCanAccessModule } from "@/lib/permissions-effective";
import { combinedNpsStats, type StatTask } from "@/lib/surveys/logic";
import type { EffectivePermissions } from "@/lib/permissions-effective";

function appUrl() {
  return getBaseUrl();
}

function fmtDate(iso: string) {
  return formatDateTr(iso, { dateStyle: "medium" });
}

function money(n: number) {
  return formatTry(n);
}

type Rel = { id?: string; full_name?: string } | { id?: string; full_name?: string }[] | null;

function rel(value: Rel): { id?: string; full_name?: string } | null {
  if (!value) return null;
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

/** NPS bantları: 0-6 kötüleyen, 7-8 pasif, 9-10 destekleyen. */
function npsOf(scores: number[]): number | null {
  if (scores.length === 0) return null;
  const promoters = scores.filter((s) => s >= 9).length;
  const detractors = scores.filter((s) => s <= 6).length;
  return Math.round(((promoters - detractors) / scores.length) * 100);
}

function avgOf(scores: number[]): number | null {
  if (scores.length === 0) return null;
  return Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10;
}

/** Puan rozeti — anket formundaki bant renkleriyle aynı (0-6/7-8/9-10). */
function ScoreBadge({ score }: { score: number }) {
  const cls =
    score <= 6
      ? "bg-danger-500/10 text-danger-500"
      : score <= 8
        ? "bg-amber-500/12 text-amber-600"
        : "bg-mint-500/12 text-[color:var(--viz-pos)]";
  return (
    <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-control)] text-sm font-extrabold tabular-nums ${cls}`}>
      {score}
    </span>
  );
}

/**
 * Memnuniyet (NPS) raporu — kapanış sonrası anketlerin toplulaştırması.
 *
 * NPS = %destekleyen(9-10) − %kötüleyen(0-6), yalnız CEVAPLANAN anketler
 * üzerinden. Anket üretimi de buradan yapılır (anlaşma detayına buton
 * ekleme yok — o alan başka modülün; kapanan anlaşmalar burada listelenir).
 */
export async function SonucView({ perms }: { perms: EffectivePermissions }) {
  const ctx = { perms };
  const supabase = await createClient();

  const canSurveys = effectiveCanAccessModule(ctx.perms, "surveys");
  const [surveysRes, { data: wonDeals }, { data: profiles }, { data: taskData }] = await Promise.all([
    // PostgREST 1000 satır sınırı: NPS/oran gerçek sayıdan hesaplansın diye sayfalı okunur.
    fetchAllRows((from, to) =>
      supabase
        .from("surveys")
        .select("id, deal_id, agent_id, public_token, score, comment, status, sent_at, answered_at, customer:customers!surveys_customer_id_fkey(id, full_name)")
        .order("sent_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to),
    ),
    supabase
      .from("deals")
      .select("id, deal_value, deal_type, customer_id, assigned_to, updated_at, customer:customers!deals_customer_id_fkey(id, full_name)")
      .eq("stage", "won")
      .order("updated_at", { ascending: false })
      .limit(200),
    supabase.from("profiles").select("id, full_name").limit(500),
    // Anket modülü görevleri (satıcı/malik, ziyaretçi, kira, kayıp kitleleri). Tablo yoksa / yetki yoksa boş.
    canSurveys
      ? fetchAllRows((from, to) =>
          supabase
            .from("survey_tasks")
            .select("id, event_type, audience, status, score, agent_id, assigned_to, deal_id, completed_at")
            .neq("event_type", "advisor_pulse")
            .eq("status", "completed")
            .order("id", { ascending: true })
            .range(from, to),
        )
      : Promise.resolve({ data: [] as StatTask[] }),
  ]);

  const agentName = new Map((profiles ?? []).map((p) => [String(p.id), String(p.full_name)]));
  assertQueryBatchSucceeded([surveysRes], ["surveys"], "Memnuniyet");
  const rows = surveysRes.data ?? [];
  const answered = rows.filter((s) => s.status === "answered" && s.score !== null);
  const pending = rows.filter((s) => s.status === "pending");
  const tasks = (taskData ?? []) as (StatTask & { deal_id?: string | null })[];
  // Birleşik NPS: kapanış link anketi + anket modülü (satıcı/malik dahil; aynı anlaşmanın alıcı/kiracı cevabı tek sayılır).
  const combined = combinedNpsStats(
    tasks,
    rows.map((s) => ({ deal_id: (s.deal_id as string | null) ?? null, score: s.score === null ? null : Number(s.score), status: String(s.status) })),
  );

  const nps = combined?.nps ?? null;
  const avg = combined?.avg ?? null;
  const responseRate = rows.length > 0 ? Math.round((answered.length / rows.length) * 100) : null;
  const promoters = combined?.promoters ?? 0;
  const passives = combined?.passives ?? 0;
  const detractors = combined?.detractors ?? 0;

  // Danışman bazlı tablo — yalnız cevaplanan anketler puana girer.
  const byAgent = new Map<string, { id: string; name: string; total: number; scores: number[] }>();
  for (const s of rows) {
    const key = (s.agent_id as string | null) ?? "-";
    const cur = byAgent.get(key) ?? {
      id: key,
      name: key === "-" ? "Atanmamış" : (agentName.get(key) ?? "Danışman"),
      total: 0,
      scores: [],
    };
    cur.total += 1;
    if (s.status === "answered" && s.score !== null) cur.scores.push(Number(s.score));
    byAgent.set(key, cur);
  }
  const agentRows = [...byAgent.values()].sort(
    (a, b) => (npsOf(b.scores) ?? -101) - (npsOf(a.scores) ?? -101) || b.scores.length - a.scores.length,
  );

  const comments = answered.filter((s) => (s.comment ?? "").toString().trim()).slice(0, 12);

  // Anket oluştur — kapanmış VE henüz anketi olmayan anlaşmalar.
  const surveyedDeals = new Set(rows.map((s) => s.deal_id as string | null).filter(Boolean));
  const openForSurvey = (wonDeals ?? [])
    .filter((d) => d.customer_id && !surveyedDeals.has(String(d.id)))
    .slice(0, 25);

  const base = appUrl();
  const npsTone = nps === null ? "text-text-muted" : nps >= 30 ? "text-[color:var(--viz-pos)]" : nps >= 0 ? "text-amber-700" : "text-danger-500";

  return (
    <div className="space-y-6">
      <details className="rounded-[var(--radius-card)] border border-line bg-canvas/60 px-3 py-2 text-xs text-text-muted">
        <summary className="focus-ring cursor-pointer font-semibold text-ink-950 touch:min-h-11 touch:py-2.5">Nasıl hesaplanır?</summary>
        <p className="mt-2">
          Kapanış sonrası 0-10 puan anketi · NPS = %destekleyen (9-10) − %kötüleyen (0-6). Anketörün telefonla aldığı kapanış cevapları da bu sayılara dahildir.
        </p>
      </details>
      <StatRow
        label="Memnuniyet özeti"
        items={[
          {
            label: "Memnuniyet puanı (NPS)",
            value: nps === null ? "—" : String(nps),
            hint: nps === null ? "Henüz yanıt yok" : `${promoters} destekleyen · ${passives} pasif · ${detractors} kötüleyen`,
            icon: <Gauge className="h-4 w-4" aria-hidden="true" />,
            href: "/app/anketler?durum=tamamlandi#kitle",
          },
          {
            label: "Memnuniyet (CSAT)",
            value: combined ? `%${combined.csat}` : "—",
            hint: combined ? `${combined.n} cevap · 7-10 veren oranı` : "Henüz yanıt yok",
            icon: <Smile className="h-4 w-4" aria-hidden="true" />,
            href: "/app/anketler?durum=tamamlandi#liste",
          },
          {
            label: "Yanıt oranı",
            value: responseRate === null ? "—" : `%${responseRate}`,
            hint: `${answered.length} yanıt / ${rows.length} kapanış anketi`,
            icon: <Send className="h-4 w-4" aria-hidden="true" />,
            href: "/app/anketler?durum=kapanan",
          },
          {
            label: "Ortalama puan",
            value: avg === null ? "—" : avg.toLocaleString("tr-TR"),
            hint: "0-10 ölçeği",
            icon: <Star className="h-4 w-4" aria-hidden="true" />,
            href: "/app/anketler?durum=tamamlandi#liste",
          },
          {
            label: "Bekleyen anket",
            value: String(pending.length),
            hint: "Linki iletilmeyi bekliyor",
            icon: <Hourglass className="h-4 w-4" aria-hidden="true" />,
            href: "/app/anketler/kuyruk?durum=bekleyen",
          },
        ]}
      />

      {/* Anket oluştur — kapanan ve anketi olmayan anlaşmalar */}
      <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
        <div className="flex flex-wrap items-center gap-2">
          <Send className="h-4 w-4 text-accent-text" />
          <h2 className="font-display font-bold text-text">Anket oluştur</h2>
          <span className="ml-auto text-xs text-text-muted">
            {openForSurvey.length} kapanan anlaşma anket bekliyor
          </span>
        </div>
        <p className="mt-1 text-xs text-text-muted">
          Tek tıkla anket linki üretilir; SMS gönderilmez — linki kopyalayıp müşteriye siz iletirsiniz,
          danışmana bildirim düşer.
        </p>
        {openForSurvey.length === 0 ? (
          <div className="mt-4">
            <EmptyState illustration="rapor"
              icon={Smile}
              title="Anket bekleyen kapanış yok"
              description="Kazanılan her anlaşma burada listelenir; tümü için anket üretilmiş durumda."
              tone="mint"
            />
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-line">
            {openForSurvey.map((d) => {
              const cust = rel(d.customer as Rel);
              return (
                <li key={String(d.id)} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <Link
                      href={cust?.id ? `/app/musteriler/${cust.id}` : "/app/musteriler"}
                      className="focus-ring rounded-[var(--radius-control)] text-sm font-semibold text-text underline-offset-2 hover:underline"
                    >
                      {cust?.full_name ?? "Müşteri"}
                    </Link>
                    <p className="text-xs text-text-muted">
                      {dealTypeLabel(d.deal_type)}
                      {d.deal_value ? ` · ${money(Number(d.deal_value))}` : ""} · kapanış {fmtDate(String(d.updated_at))}
                      {d.assigned_to ? ` · ${agentName.get(String(d.assigned_to)) ?? "Danışman"}` : ""}
                    </p>
                  </div>
                  <CreateSurveyButton dealId={String(d.id)} />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Danışman bazlı NPS */}
        <section id="danisman" className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-accent-text" />
            <h2 className="font-display font-bold text-text">Danışman bazlı</h2>
          </div>
          {agentRows.length === 0 ? (
            <p className="py-10 text-center text-sm text-text-muted">
              Henüz anket yok. Kapanan anlaşmalardan anket üretince danışman kırılımı burada oluşur.
            </p>
          ) : (
            <TableFrame className="mt-4" minWidth={420} stack>
              <Table className="w-full text-sm">
                <THead>
                  <TR className="border-b border-line text-left text-xs font-bold uppercase tracking-[0.08em] text-text-muted">
                    <TH className="py-2 pr-3">Danışman</TH>
                    <TH className="py-2 pr-3 text-right">Yanıt</TH>
                    <TH className="py-2 pr-3 text-right">Memnuniyet</TH>
                    <TH className="py-2 text-right">Ort. puan</TH>
                  </TR>
                </THead>
                <TBody>
                  {agentRows.map((a) => {
                    const aNps = npsOf(a.scores);
                    const aAvg = avgOf(a.scores);
                    return (
                      <TR key={a.id} className="border-b border-line/60 last:border-0">
                        <TD label="Danışman" className="py-2.5 pr-3 font-semibold text-text">{a.name}</TD>
                        <TD label="Yanıt" className="py-2.5 pr-3 text-right tabular-nums text-text-muted">
                          {a.scores.length}/{a.total}
                        </TD>
                        <TD
                          label="Memnuniyet"
                          className={`py-2.5 pr-3 text-right font-bold tabular-nums ${
                            aNps === null
                              ? "text-text-faint"
                              : aNps >= 30
                                ? "text-[color:var(--viz-pos)]"
                                : aNps >= 0
                                  ? "text-warning-strong"
                                  : "text-danger-500"
                          }`}
                        >
                          {aNps === null ? "—" : aNps}
                        </TD>
                        <TD label="Ort. puan" className="py-2.5 text-right tabular-nums text-text">
                          {aAvg === null ? "—" : aAvg.toLocaleString("tr-TR")}
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </TableFrame>
          )}
        </section>

        {/* Bekleyen anketler — link kopyala */}
        <section id="bekleyen" className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
          <div className="flex items-center gap-2">
            <Hourglass className="h-4 w-4 text-amber-500" />
            <h2 className="font-display font-bold text-text">Bekleyen anketler</h2>
            <span className="ml-auto text-xs text-text-muted">{pending.length} adet</span>
          </div>
          {pending.length === 0 ? (
            <p className="py-10 text-center text-sm text-text-muted">
              Bekleyen anket yok — üretilen tüm anketler cevaplanmış.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-line">
              {pending.slice(0, 15).map((s) => {
                const cust = rel(s.customer as Rel);
                return (
                  <li key={String(s.id)} className="flex flex-wrap items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <Link
                        href={cust?.id ? `/app/musteriler/${cust.id}` : "/app/musteriler"}
                        className="focus-ring rounded-[var(--radius-control)] text-sm font-semibold text-text underline-offset-2 hover:underline"
                      >
                        {cust?.full_name ?? "Müşteri"}
                      </Link>
                      <p className="text-xs text-text-muted">
                        Gönderim: {fmtDate(String(s.sent_at))}
                        {s.agent_id ? ` · ${agentName.get(String(s.agent_id)) ?? "Danışman"}` : ""}
                      </p>
                    </div>
                    <CopySurveyLinkButton url={`${base}/anket/${s.public_token}`} />
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {/* Son yorumlar */}
      <section id="yorumlar" className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
        <div className="flex items-center gap-2">
          <MessageSquareQuote className="h-4 w-4 text-accent-text" />
          <h2 className="font-display font-bold text-text">Son yorumlar</h2>
          <span className="ml-auto text-xs text-text-muted">{comments.length} yorum</span>
        </div>
        {comments.length === 0 ? (
          <p className="py-10 text-center text-sm text-text-muted">
            Henüz yorum yok. Müşteriler ankette yorum bıraktıkça burada listelenir.
          </p>
        ) : (
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {comments.map((s) => {
              const cust = rel(s.customer as Rel);
              return (
                <li key={String(s.id)} className="min-w-0 rounded-[var(--radius-card)] border border-line bg-canvas/60 p-4">
                  <div className="flex items-center gap-3">
                    <ScoreBadge score={Number(s.score)} />
                    <div className="min-w-0">
                      <Link
                        href={cust?.id ? `/app/musteriler/${cust.id}` : "/app/musteriler"}
                        className="focus-ring block truncate rounded-[var(--radius-control)] text-sm font-bold text-text underline-offset-2 hover:underline"
                      >
                        {cust?.full_name ?? "Müşteri"}
                      </Link>
                      <p className="text-xs text-text-muted">
                        {s.answered_at ? fmtDate(String(s.answered_at)) : ""}
                        {s.agent_id ? ` · ${agentName.get(String(s.agent_id)) ?? "Danışman"}` : ""}
                      </p>
                    </div>
                  </div>
                  <p className="mt-3 break-words text-sm leading-relaxed text-text-muted">
                    &ldquo;{String(s.comment)}&rdquo;
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
