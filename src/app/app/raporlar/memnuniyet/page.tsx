import { PageHeader } from "@/components/ui/page-header";
import Link from "next/link";
import {
  ArrowUpRight,
  Gauge,
  Hourglass,
  MessageSquareQuote,
  Send,
  Smile,
  Star,
  Users,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { EmptyState } from "@/components/app/empty-state";
import { getBaseUrl } from "@/lib/base-url";
import { CopySurveyLinkButton, CreateSurveyButton } from "./survey-actions";
import { formatDateTr } from "@/lib/format";
import { effectiveCanAccessModule } from "@/lib/permissions-effective";

function appUrl() {
  return getBaseUrl();
}

function fmtDate(iso: string) {
  return formatDateTr(iso, { dateStyle: "medium" });
}

function money(n: number) {
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(n) + " ₺";
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
export default async function SatisfactionReportPage() {
  const ctx = await requireModulePage("reports", "/app/raporlar");
  const supabase = await createClient();

  const [{ data: surveys }, { data: wonDeals }, { data: profiles }] = await Promise.all([
    supabase
      .from("surveys")
      .select("id, deal_id, agent_id, public_token, score, comment, status, sent_at, answered_at, customer:customers!surveys_customer_id_fkey(id, full_name)")
      .order("sent_at", { ascending: false })
      .limit(1000),
    supabase
      .from("deals")
      .select("id, deal_value, deal_type, customer_id, assigned_to, updated_at, customer:customers!deals_customer_id_fkey(id, full_name)")
      .eq("stage", "won")
      .order("updated_at", { ascending: false })
      .limit(200),
    supabase.from("profiles").select("id, full_name").limit(500),
  ]);

  const agentName = new Map((profiles ?? []).map((p) => [String(p.id), String(p.full_name)]));
  const rows = surveys ?? [];
  const answered = rows.filter((s) => s.status === "answered" && s.score !== null);
  const pending = rows.filter((s) => s.status === "pending");
  const allScores = answered.map((s) => Number(s.score));

  const nps = npsOf(allScores);
  const avg = avgOf(allScores);
  const responseRate = rows.length > 0 ? Math.round((answered.length / rows.length) * 100) : null;
  const promoters = allScores.filter((s) => s >= 9).length;
  const passives = allScores.filter((s) => s >= 7 && s <= 8).length;
  const detractors = allScores.filter((s) => s <= 6).length;

  // Danışman bazlı tablo — yalnız cevaplanan anketler puana girer.
  const byAgent = new Map<string, { name: string; total: number; scores: number[] }>();
  for (const s of rows) {
    const key = (s.agent_id as string | null) ?? "-";
    const cur = byAgent.get(key) ?? {
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
      {/* Hero — rapor merkezi deseni (koyu bant + KPI kartları) */}
      <PageHeader
        eyebrow="Rapor merkezi · Memnuniyet"
        title="Müşteri memnuniyeti (NPS)"
        description="Kapanış sonrası 0-10 puan anketi · NPS = %destekleyen (9-10) − %kötüleyen (0-6)"
      />
      {effectiveCanAccessModule(ctx.perms, "surveys") ? (
        <p className="-mt-3 mb-4 text-xs text-text-muted">
          Yayından kalkan, uzayan ve kaybedilen işlemler için anketör aramaları ayrı izlenir:{" "}
          <Link href="/app/anketler" className="focus-ring rounded-[var(--radius-control)] font-semibold text-accent-text underline-offset-2 hover:underline">
            Anketler ve anketör kuyruğu
          </Link>
          . Anketörün telefonla aldığı kapanış cevapları bu NPS raporuna da yansır.
        </p>
      ) : null}
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            label: "NPS skoru",
            value: nps === null ? "—" : String(nps),
            sub: nps === null ? "Henüz yanıt yok" : `${promoters} destekleyen · ${passives} pasif · ${detractors} kötüleyen`,
            icon: Gauge,
            tone: npsTone,
            href: "#danisman",
          },
          {
            label: "Yanıt oranı",
            value: responseRate === null ? "—" : `%${responseRate}`,
            sub: `${answered.length} yanıt / ${rows.length} anket`,
            icon: Send,
            tone: "text-accent-text",
            href: "#bekleyen",
          },
          {
            label: "Ortalama puan",
            value: avg === null ? "—" : avg.toLocaleString("tr-TR"),
            sub: "0-10 ölçeği",
            icon: Star,
            tone: "text-amber-700",
            href: "#yorumlar",
          },
          {
            label: "Bekleyen anket",
            value: String(pending.length),
            sub: "Linki iletilmeyi bekliyor",
            icon: Hourglass,
            tone: "text-[color:var(--viz-pos)]",
            href: "#bekleyen",
          },
        ].map((k) => (
          <a
            key={k.label}
            href={k.href}
            className="focus-ring press lift group block rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)] transition hover:border-border-interactive"
          >
            <span className="flex items-start justify-between">
              <k.icon className={`h-4 w-4 ${k.tone}`} />
              <ArrowUpRight className="hover-action h-4 w-4 text-text-faint opacity-0 transition group-hover:text-accent-text group-hover:opacity-100" />
            </span>
            <p className={`numeric mt-2 font-display text-xl font-extrabold ${k.label === "NPS skoru" ? k.tone : "text-text"}`}>{k.value}</p>
            <p className="text-xs font-medium text-text-muted">{k.label}</p>
            <p className="mt-0.5 text-xs text-text-faint">{k.sub}</p>
          </a>
        ))}
      </div>

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
                      {d.deal_type === "rent" ? "Kiralama" : "Satış"}
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
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs font-bold uppercase tracking-[0.08em] text-text-muted">
                    <th className="py-2 pr-3">Danışman</th>
                    <th className="py-2 pr-3 text-right">Yanıt</th>
                    <th className="py-2 pr-3 text-right">NPS</th>
                    <th className="py-2 text-right">Ort. puan</th>
                  </tr>
                </thead>
                <tbody>
                  {agentRows.map((a) => {
                    const aNps = npsOf(a.scores);
                    const aAvg = avgOf(a.scores);
                    return (
                      <tr key={a.name} className="border-b border-line/60 last:border-0">
                        <td className="py-2.5 pr-3 font-semibold text-text">{a.name}</td>
                        <td className="py-2.5 pr-3 text-right tabular-nums text-text-muted">
                          {a.scores.length}/{a.total}
                        </td>
                        <td
                          className={`py-2.5 pr-3 text-right font-bold tabular-nums ${
                            aNps === null
                              ? "text-text-faint"
                              : aNps >= 30
                                ? "text-[color:var(--viz-pos)]"
                                : aNps >= 0
                                  ? "text-amber-600"
                                  : "text-danger-500"
                          }`}
                        >
                          {aNps === null ? "—" : aNps}
                        </td>
                        <td className="py-2.5 text-right tabular-nums text-text">
                          {aAvg === null ? "—" : aAvg.toLocaleString("tr-TR")}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
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
                <li key={String(s.id)} className="rounded-[var(--radius-card)] border border-line bg-canvas/60 p-4">
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
                  <p className="mt-3 text-sm leading-relaxed text-text-muted">
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
