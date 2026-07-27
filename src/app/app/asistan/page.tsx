import Link from "next/link";
import {
  ArrowUpRight,
  Bot,
  Building2,
  CalendarClock,
  CheckCircle2,
  Clock,
  FileSearch,
  Flame,
  Handshake,
  ListChecks,
  MessageSquareText,
  Sparkles,
  Trophy,
  Users,
} from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { isAiConfigured } from "@/lib/ai-advisor";
import { msSince } from "@/lib/clock";
import {
  getTenantAdvisorSnapshot,
  listTenantAdvisorSessions,
} from "@/app/actions/ai-tenant-advisor";
import { getAsistanInsights } from "./insights";
import { TenantAdvisorChat } from "./advisor-chat";

export const metadata = { title: "AI Asistan" };

/** Server tarafı bağıl zaman — clock.msSince üzerinden (render'da Date.now yok). */
function relativeTime(iso: string): string {
  const mins = Math.floor(msSince(iso) / 60_000);
  if (mins < 1) return "az önce";
  if (mins < 60) return `${mins} dk önce`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} sa önce`;
  return `${Math.floor(hrs / 24)} gün önce`;
}

/** Hazır komut galerisi — tıklanınca ?q= ile asistana ilk mesaj olarak gider. */
const COMMAND_GALLERY: {
  category: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: string;
  prompts: string[];
}[] = [
  {
    category: "Müşteri",
    icon: Users,
    tone: "bg-brand-600/10 text-brand-600",
    prompts: ["Bugün kimi aramalıyım?", "Uzun süredir dokunulmayan müşterilerim var mı?"],
  },
  {
    category: "Portföy",
    icon: Building2,
    tone: "bg-cyan-500/12 text-cyan-700",
    prompts: ["Fiyatı yüksek portföylerim hangileri?", "Portföylerimin fiyat sağlığı nasıl?"],
  },
  {
    category: "Performans",
    icon: Trophy,
    tone: "bg-mint-500/12 text-mint-600",
    prompts: ["Bu ay performansım nasıl?", "Komisyon tahsilatlarımda bekleyen var mı?"],
  },
  {
    category: "Planlama",
    icon: CalendarClock,
    tone: "bg-amber-400/15 text-amber-600",
    prompts: ["Bugünü nasıl planlamalıyım?", "Gecikmiş görevlerimi nasıl önceliklendirmeliyim?"],
  },
];

export default async function AsistanPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; oturum?: string }>;
}) {
  await requireModulePage("dashboard");
  const { q = "", oturum = "" } = (await searchParams) ?? {};

  const [snapshot, aiEnabled, insights, sessions] = await Promise.all([
    getTenantAdvisorSnapshot(),
    isAiConfigured(),
    getAsistanInsights(),
    listTenantAdvisorSessions(6),
  ]);

  const kpis = [
    { label: "Müşteri", value: snapshot?.customers ?? 0, icon: Users, tone: "text-brand-400", href: "/app/musteriler" },
    { label: "Portföy", value: snapshot?.properties ?? 0, icon: Building2, tone: "text-cyan-400", href: "/app/portfoyler" },
    { label: "Sıcak müşteri", value: snapshot?.hotLeads ?? 0, icon: Flame, tone: "text-amber-400", href: "/app/musteriler?sort=hot" },
    { label: "Geciken görev", value: snapshot?.tasksOverdue ?? 0, icon: ListChecks, tone: "text-amber-300", href: "/app/gorevler?filter=overdue" },
    { label: "Bugünkü randevu", value: insights.todayAppointments, icon: CalendarClock, tone: "text-mint-400", href: "/app/randevular" },
    { label: "Yeni talep", value: insights.newDemands, icon: FileSearch, tone: "text-cyan-400", href: "/app/talepler" },
    { label: "Aktif anlaşma", value: insights.activeDeals, icon: Handshake, tone: "text-brand-300", href: "/app/anlasmalar" },
    { label: "Bu ay kazanılan", value: insights.wonThisMonth, icon: Trophy, tone: "text-mint-300", href: "/app/anlasmalar" },
  ];

  // Öneri kartları — TAMAMEN gerçek sayılardan türetilir; koşulu sağlamayan kart çizilmez.
  const focusCards: {
    key: string;
    icon: React.ComponentType<{ className?: string }>;
    tone: string;
    title: string;
    description: string;
    href: string;
    hrefLabel: string;
    ask: string;
  }[] = [];

  if ((snapshot?.tasksOverdue ?? 0) > 0) {
    focusCards.push({
      key: "overdue",
      icon: ListChecks,
      tone: "bg-amber-400/15 text-amber-600",
      title: `${snapshot!.tasksOverdue} gecikmiş görev`,
      description: "Termini geçen görevler birikiyor — önce en eskilerini kapatın.",
      href: "/app/gorevler?filter=overdue",
      hrefLabel: "Görevlere git",
      ask: "Gecikmiş görevlerimi nasıl önceliklendirmeliyim?",
    });
  }
  if ((snapshot?.hotLeads ?? 0) > 0) {
    focusCards.push({
      key: "hot",
      icon: Flame,
      tone: "bg-brand-600/10 text-brand-600",
      title: `${snapshot!.hotLeads} sıcak müşteri`,
      description: "Skoru yüksek müşteriler dönüş bekliyor — bugün arayın.",
      href: "/app/musteriler?sort=hot",
      hrefLabel: "Listeyi aç",
      ask: "Bugün kimi aramalıyım?",
    });
  }
  if (insights.newDemands > 0) {
    focusCards.push({
      key: "demands",
      icon: FileSearch,
      tone: "bg-cyan-500/12 text-cyan-700",
      title: `${insights.newDemands} yeni talep`,
      description: "İşlenmemiş talepleri portföylerle eşleştirip fırsata çevirin.",
      href: "/app/eslestirme",
      hrefLabel: "Eşleştirmeye git",
      ask: "Yeni talepler için nasıl bir eşleştirme stratejisi izlemeliyim?",
    });
  }
  if (insights.todayAppointments > 0) {
    focusCards.push({
      key: "appts",
      icon: CalendarClock,
      tone: "bg-mint-500/12 text-mint-600",
      title: `Bugün ${insights.todayAppointments} randevu`,
      description: "Randevu öncesi müşteri geçmişini ve portföy notlarını gözden geçirin.",
      href: "/app/randevular",
      hrefLabel: "Randevulara git",
      ask: "Bugünkü randevularıma nasıl hazırlanmalıyım?",
    });
  }

  return (
    <div className="space-y-5">
      {/* Hero — komuta merkezi başlığı + 8 canlı KPI */}
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
        <div className="pointer-events-none absolute -right-14 -top-14 h-52 w-52 rounded-full bg-brand-500/25 blur-[90px]" />
        <div className="pointer-events-none absolute -left-16 bottom-0 h-44 w-44 rounded-full bg-mint-500/15 blur-[80px]" />
        <div className="relative">
          <span className="flex items-center gap-2 text-xs font-semibold text-brand-300">
            <Sparkles className="h-4 w-4" /> EmlakSoft · Yapay zeka
          </span>
          <h1 className="mt-2 font-display text-2xl font-extrabold md:text-3xl">AI Asistan — Komuta Merkezi</h1>
          <p className="mt-1 max-w-xl text-sm text-white/75">
            Ofisinizin canlı verilerine bağlı akıllı asistan. Kimi arayacağınızı, performansınızı ve
            fiyatı riskli portföylerinizi sorun; somut, tıklanabilir öneriler alın.
          </p>
        </div>
        <div className="relative mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {kpis.map((k) => (
            <Link
              key={k.label}
              href={k.href}
              className="focus-ring press group relative block rounded-[14px] border border-white/12 bg-white/8 p-3 backdrop-blur transition hover:border-white/25 hover:bg-white/12"
            >
              <ArrowUpRight className="hover-action absolute right-2.5 top-2.5 h-3.5 w-3.5 text-white/40 opacity-0 transition group-hover:text-amber-300 group-hover:opacity-100" />
              <k.icon className={`h-4 w-4 ${k.tone}`} />
              <p className="numeric mt-2 font-display text-xl font-extrabold text-white">{k.value}</p>
              <p className="text-[11px] text-white/70">{k.label}</p>
            </Link>
          ))}
        </div>
      </section>

      {!aiEnabled ? (
        <div className="flex items-center gap-3 rounded-[14px] border border-amber-400/30 bg-amber-400/8 px-4 py-3">
          <Bot className="h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-sm text-text-muted">
            Asistan şu an <strong className="text-ink-950">akıllı yedek</strong> kipinde çalışıyor —
            yanıtlar ofisinizin canlı verilerinden kural tabanlı üretilir.
          </p>
        </div>
      ) : null}

      {/* Öneri kartları — canlı verilerden türetilen günün odakları */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 font-display text-sm font-bold text-ink-950">
          <Sparkles className="h-4 w-4 text-brand-600" /> Bugünün odakları
        </h2>
        {focusCards.length === 0 ? (
          <div className="flex items-center gap-3 rounded-[16px] border border-mint-500/25 bg-mint-500/6 px-4 py-3.5">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-mint-600" />
            <p className="text-sm text-text-muted">
              Her şey yolunda — gecikmiş görev, bekleyen talep veya acil randevu görünmüyor.{" "}
              <Link href="/app/musteriler" className="font-semibold text-brand-600 hover:underline">
                Yeni müşteri ekleyerek
              </Link>{" "}
              huniyi besleyebilirsiniz.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {focusCards.map((c) => (
              <div
                key={c.key}
                className="lift group flex flex-col rounded-[16px] border border-line bg-surface p-4 shadow-[var(--shadow-xs)]"
              >
                <div className="flex items-start justify-between">
                  <span className={`grid h-9 w-9 place-items-center rounded-[11px] ${c.tone}`}>
                    <c.icon className="h-4.5 w-4.5" />
                  </span>
                </div>
                <p className="mt-3 font-display text-sm font-bold text-ink-950">{c.title}</p>
                <p className="mt-1 flex-1 text-xs leading-relaxed text-text-muted">{c.description}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Link
                    href={c.href}
                    className="focus-ring press inline-flex min-h-10 items-center gap-1 rounded-[9px] bg-ink-950 px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90"
                  >
                    {c.hrefLabel} <ArrowUpRight className="h-3 w-3" />
                  </Link>
                  <Link
                    href={`/app/asistan?q=${encodeURIComponent(c.ask)}`}
                    className="focus-ring press inline-flex min-h-10 items-center gap-1 rounded-[9px] border border-line px-3 py-1.5 text-xs font-semibold text-brand-600 transition hover:border-brand-300 hover:bg-brand-600/5"
                  >
                    <Sparkles className="h-3 w-3" /> Asistana sor
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Sohbet — ?q ilk mesaj, ?oturum geçmiş sohbeti açar; key remount garantiler */}
      <TenantAdvisorChat
        key={oturum || q || "yeni"}
        aiEnabled={aiEnabled}
        initialQuestion={q.trim() || undefined}
        initialSessionId={oturum.trim() || undefined}
      />

      {/* Alt bölge: hazır komut galerisi + son konuşmalar */}
      <div className="grid gap-5 lg:grid-cols-3">
        <section className="rounded-[18px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)] lg:col-span-2">
          <h2 className="mb-3 flex items-center gap-2 font-display text-sm font-bold text-ink-950">
            <MessageSquareText className="h-4 w-4 text-brand-600" /> Hazır komut galerisi
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {COMMAND_GALLERY.map((g) => (
              <div key={g.category}>
                <p className="flex items-center gap-2 text-xs font-bold text-text-muted">
                  <span className={`grid h-6 w-6 place-items-center rounded-[8px] ${g.tone}`}>
                    <g.icon className="h-3.5 w-3.5" />
                  </span>
                  {g.category}
                </p>
                <div className="mt-2 space-y-1.5">
                  {g.prompts.map((p) => (
                    <Link
                      key={p}
                      href={`/app/asistan?q=${encodeURIComponent(p)}`}
                      className="focus-ring press group flex min-h-10 items-center justify-between gap-2 rounded-[11px] border border-line bg-canvas/50 px-3 py-2 text-xs text-ink-950 transition hover:border-brand-300 hover:bg-canvas"
                    >
                      <span className="truncate">{p}</span>
                      <ArrowUpRight className="h-3 w-3 shrink-0 text-text-faint transition group-hover:text-brand-600" />
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-[18px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
          <h2 className="mb-3 flex items-center gap-2 font-display text-sm font-bold text-ink-950">
            <Clock className="h-4 w-4 text-brand-600" /> Son konuşmalar
          </h2>
          {sessions.length === 0 ? (
            <p className="rounded-[12px] border border-dashed border-line-strong bg-canvas/50 px-3 py-6 text-center text-xs text-text-muted">
              Henüz kayıtlı sohbet yok — yukarıdan bir soru sorarak başlayın.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {sessions.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/app/asistan?oturum=${s.id}`}
                    className="focus-ring press group flex min-h-10 items-center justify-between gap-2 rounded-[11px] border border-line bg-canvas/50 px-3 py-2 transition hover:border-brand-300 hover:bg-canvas"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-semibold text-ink-950 group-hover:text-brand-600">
                        {s.title ?? "Sohbet"}
                      </span>
                      <span className="text-[11px] text-text-faint">{relativeTime(s.updated_at)}</span>
                    </span>
                    <ArrowUpRight className="h-3 w-3 shrink-0 text-text-faint transition group-hover:text-brand-600" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
