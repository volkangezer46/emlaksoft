import Link from "next/link";
import { ArrowUpRight, Bot, Building2, Flame, ListChecks, Sparkles, Users } from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { isAiConfigured } from "@/lib/ai-advisor";
import { getTenantAdvisorSnapshot } from "@/app/actions/ai-tenant-advisor";
import { TenantAdvisorChat } from "./advisor-chat";

export default async function AsistanPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string }>;
}) {
  await requireModulePage("dashboard");
  const { q = "" } = (await searchParams) ?? {};

  const [snapshot, aiEnabled] = await Promise.all([getTenantAdvisorSnapshot(), isAiConfigured()]);

  const kpis = [
    { label: "Müşteri", value: String(snapshot?.customers ?? 0), icon: Users, tone: "text-brand-400", href: "/app/musteriler" },
    { label: "Portföy", value: String(snapshot?.properties ?? 0), icon: Building2, tone: "text-cyan-400", href: "/app/portfoyler" },
    { label: "Sıcak müşteri", value: String(snapshot?.hotLeads ?? 0), icon: Flame, tone: "text-rose-400", href: "/app/musteriler?sort=hot" },
    { label: "Geciken görev", value: String(snapshot?.tasksOverdue ?? 0), icon: ListChecks, tone: "text-amber-400", href: "/app/gorevler?filter=overdue" },
  ];

  return (
    <div className="space-y-5">
      <section className="theme-dark relative overflow-hidden rounded-[20px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
        <div className="pointer-events-none absolute -right-14 -top-14 h-52 w-52 rounded-full bg-brand-500/25 blur-[90px]" />
        <div className="relative">
          <span className="flex items-center gap-2 text-xs font-semibold text-brand-300">
            <Sparkles className="h-4 w-4" /> EmlakSoft · Yapay zeka
          </span>
          <h1 className="mt-2 font-display text-2xl font-extrabold md:text-3xl">AI Asistan</h1>
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
              <p className="mt-2 font-display text-xl font-extrabold text-white">{k.value}</p>
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

      <TenantAdvisorChat aiEnabled={aiEnabled} initialQuestion={q.trim() || undefined} />
    </div>
  );
}
