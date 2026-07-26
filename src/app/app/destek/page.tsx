import Link from "next/link";
import { ArrowUpRight, CheckCircle2, Clock3, LifeBuoy } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { getDefinitions } from "@/lib/definitions";
import { NewTicketDialog } from "./new-ticket-dialog";
import type { CSSProperties } from "react";

const RING_C = 2 * Math.PI * 42;

const statusLabel: Record<string, string> = {
  open: "Açık",
  in_progress: "İşleniyor",
  waiting: "Yanıt bekleniyor",
  resolved: "Çözüldü",
  closed: "Kapalı",
};

const statusCls: Record<string, string> = {
  open: "bg-brand-600/10 text-brand-600",
  in_progress: "bg-cyan-400/12 text-cyan-600",
  waiting: "bg-amber-400/15 text-amber-600",
  resolved: "bg-mint-500/12 text-mint-600",
  closed: "bg-ink-950/8 text-text-muted",
};

const statusColor: Record<string, string> = {
  open: "var(--brand-500)",
  in_progress: "var(--cyan-400)",
  waiting: "var(--amber-400)",
  resolved: "var(--mint-500)",
  closed: "rgba(10,18,36,0.2)",
};

const catLabel: Record<string, string> = {
  general: "Genel",
  billing: "Fatura",
  bug: "Hata",
  feature: "Özellik",
  compliance: "Uyum",
  onboarding: "Kurulum",
};

// Öncelik ham enum değerleri ekrana düşüyordu ("urgent" gibi) — Türkçe karşılık.
const priorityLabel: Record<string, string> = {
  low: "Düşük",
  normal: "Normal",
  high: "Yüksek",
  urgent: "Acil",
};

/*
 * ?durum= kontratı: ham durum değerleri + "acik" bileşimi.
 * "Açık / bekleyen" KPI'ı üç durumu (open+in_progress+waiting) topladığı için
 * tek enum değerine indirgenemez; bileşik değer yalnızca bu sayfada üretilir.
 */
function matchesDurum(status: string, durum: string) {
  if (!durum) return true;
  if (durum === "acik") return status === "open" || status === "in_progress" || status === "waiting";
  return status === durum;
}

function durumHref(value: string) {
  return value ? `/app/destek?durum=${value}` : "/app/destek";
}

export default async function SupportPage({
  searchParams,
}: {
  searchParams?: Promise<{ durum?: string }>;
}) {
  await requireModulePage("support");
  const { durum = "" } = (await searchParams) ?? {};
  const supabase = await createClient();
  const [{ data: tickets }, categoryDefs] = await Promise.all([
    supabase
      .from("support_tickets")
      .select("id, subject, category, priority, status, created_at, updated_at")
      .order("created_at", { ascending: false })
      .limit(100),
    getDefinitions("ticket_category"),
  ]);

  const categoryOptions = categoryDefs.length
    ? categoryDefs.map((d) => ({ value: d.value, label: d.label }))
    : undefined;

  const rows = tickets ?? [];
  const openCount = rows.filter((t) => t.status === "open" || t.status === "in_progress" || t.status === "waiting").length;
  const resolved = rows.filter((t) => t.status === "resolved").length;

  // KPI/halka tüm kayıtlardan; liste ?durum= ile daralır.
  const visible = durum ? rows.filter((t) => matchesDurum(t.status, durum)) : rows;

  const statusKeys = ["open", "in_progress", "waiting", "resolved", "closed"] as const;
  const statusCounts = statusKeys.map((k) => ({
    key: k,
    label: statusLabel[k],
    count: rows.filter((t) => t.status === k).length,
    color: statusColor[k],
  }));
  const total = Math.max(1, rows.length);
  let offset = 0;
  const arcs = statusCounts.map((s) => {
    const len = (s.count / total) * RING_C;
    const item = { ...s, dash: len, offset };
    offset += len;
    return item;
  });
  const resolveRate = rows.length ? resolved / rows.length : 0;

  return (
    <div className="space-y-6">
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-14 -top-16 h-56 w-56 rounded-full bg-mint-500/20 blur-[90px]" />
        <div className="relative grid gap-6 lg:grid-cols-[1.2fr_1fr] lg:items-center">
          <div>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <span className="flex items-center gap-2 text-xs font-semibold text-mint-400">
                  <LifeBuoy className="h-4 w-4" /> Destek merkezi
                </span>
                <h1 className="mt-2 font-display text-2xl font-extrabold text-white md:text-3xl">Talepleriniz</h1>
                <p className="mt-1 text-sm text-white/60">EmlakSoft ekibine fatura, kurulum ve teknik taleplerinizi iletin.</p>
              </div>
              <NewTicketDialog categoryOptions={categoryOptions} />
            </div>
            {/* KPI kartları listeyi ?durum= parametresiyle süzer */}
            <div className="mt-6 grid grid-cols-3 gap-3">
              {[
                { label: "Toplam talep", value: rows.length, cls: "", durum: "" },
                { label: "Açık / bekleyen", value: openCount, cls: "text-amber-300", durum: "acik" },
                { label: "Çözülen", value: resolved, cls: "text-mint-400", durum: "resolved" },
              ].map((k) => (
                <Link
                  key={k.label}
                  href={durumHref(k.durum)}
                  className={`focus-ring press group relative block rounded-[14px] border bg-white/5 p-3 transition hover:border-white/30 ${
                    durum === k.durum && k.durum !== "" ? "border-white/40" : "border-white/10"
                  }`}
                >
                  <ArrowUpRight className="hover-action absolute right-2 top-2 h-3.5 w-3.5 text-white/50 opacity-0 transition group-hover:opacity-100" />
                  <p className={`font-display text-xl font-extrabold ${k.cls}`}>{k.value}</p>
                  <p className="text-[11px] text-white/45">{k.label}</p>
                </Link>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-5 rounded-[16px] border border-white/10 bg-white/[0.04] p-4 backdrop-blur">
            <div className="relative grid h-28 w-28 place-items-center">
              <div
                className="conic-spin pointer-events-none absolute inset-2 rounded-full opacity-25 blur-md"
                style={{ background: "conic-gradient(from 0deg, var(--mint-400), var(--brand-500), var(--mint-400))" }}
              />
              <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
                <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="10" />
                {rows.length === 0 ? (
                  <circle
                    cx="50"
                    cy="50"
                    r="42"
                    fill="none"
                    stroke="var(--mint-400)"
                    strokeWidth="10"
                    strokeLinecap="round"
                    className="ring-sweep"
                    style={{ "--circ": RING_C, "--dash": RING_C * 0.85 } as CSSProperties}
                  />
                ) : (
                  arcs.filter((a) => a.count > 0).map((a) => (
                    /* SVG içi <a>: segment tıklanınca liste o duruma süzülür */
                    <a key={a.key} href={durumHref(a.key)} aria-label={`${a.label} taleplerini listele`} className="cursor-pointer">
                      <circle
                        cx="50"
                        cy="50"
                        r="42"
                        fill="none"
                        stroke={a.color}
                        strokeWidth="10"
                        strokeDasharray={`${a.dash} ${RING_C - a.dash}`}
                        strokeDashoffset={-a.offset}
                      />
                    </a>
                  ))
                )}
              </svg>
              <div className="absolute text-center">
                <p className="font-display text-xl font-extrabold text-white">%{Math.round(resolveRate * 100)}</p>
                <p className="text-[10px] text-white/45">çözüm</p>
              </div>
            </div>
            <div className="space-y-1.5 text-xs">
              {statusCounts.map((s) => (
                <Link
                  key={s.key}
                  href={durumHref(s.key)}
                  className={`focus-ring group flex items-center gap-2 rounded-[6px] px-1 py-0.5 transition hover:bg-white/5 ${
                    durum === s.key ? "bg-white/10 text-white" : "text-white/70"
                  }`}
                >
                  <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                  <span className="flex-1 group-hover:text-white">{s.label}</span>
                  <span className="font-bold text-white">{s.count}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-[20px] border border-line bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
            <Clock3 className="h-4 w-4 text-brand-600" /> Talep geçmişi
          </h2>
          {rows.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {[{ label: "Tümü", value: "" }, ...statusKeys.map((k) => ({ label: statusLabel[k], value: k as string }))].map((f) => (
                <Link
                  key={f.value}
                  href={durumHref(f.value)}
                  className={`focus-ring rounded-full px-2.5 py-1 text-[11px] font-bold transition ${
                    durum === f.value ? "bg-ink-950 text-white" : "border border-line text-text-muted hover:text-ink-950"
                  }`}
                >
                  {f.label}
                </Link>
              ))}
            </div>
          ) : null}
        </div>
        {rows.length === 0 ? (
          <div className="grid place-items-center px-6 py-14 text-center">
            <LifeBuoy className="h-8 w-8 text-text-faint" />
            <p className="mt-3 font-display font-bold text-ink-950">Henüz talep yok</p>
            <p className="mt-1 text-sm text-text-muted">İlk destek talebinizi oluşturduğunuzda burada listelenir.</p>
          </div>
        ) : visible.length === 0 ? (
          <div className="grid place-items-center px-6 py-14 text-center">
            <LifeBuoy className="h-8 w-8 text-text-faint" />
            <p className="mt-3 font-display font-bold text-ink-950">Bu durumda talep yok</p>
            <Link href="/app/destek" className="mt-1 text-sm font-semibold text-brand-600 hover:underline">
              Filtreyi temizle
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-line">
            {visible.map((t) => (
              <Link
                key={t.id}
                href={`/app/destek/${t.id}`}
                className="grid gap-2 px-5 py-4 transition hover:bg-brand-600/[0.02] sm:grid-cols-[1fr_auto] sm:items-center"
              >
                <div className="flex items-start gap-3">
                  <span className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-[11px] ${statusCls[t.status] ?? statusCls.open}`}>
                    {t.status === "resolved" || t.status === "closed" ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : (
                      <LifeBuoy className="h-4 w-4" />
                    )}
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-ink-950">{t.subject}</p>
                    <p className="mt-1 text-xs text-text-muted">
                      {catLabel[t.category] ?? t.category} · {priorityLabel[t.priority] ?? t.priority} ·{" "}
                      {new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(t.created_at))}
                    </p>
                  </div>
                </div>
                <span className={`w-fit rounded-full px-2.5 py-1 text-[11px] font-bold ${statusCls[t.status] ?? statusCls.open}`}>
                  {statusLabel[t.status] ?? t.status}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
