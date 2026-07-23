import Link from "next/link";
import { Building2, CreditCard, Handshake, LifeBuoy, Settings2, Sparkles, TrendingUp } from "lucide-react";
import { requirePlatformModule } from "@/lib/platform";
import { buildAdvisorContext, isAiConfigured } from "@/lib/ai-advisor";
import { AdvisorChat } from "./advisor-chat";

const money = (n: number) => `₺${Math.round(n).toLocaleString("tr-TR")}`;

export default async function AdvisorPage() {
  const staff = await requirePlatformModule("advisor");
  const [ctx, aiEnabled] = await Promise.all([buildAdvisorContext(), isAiConfigured()]);

  const kpis = [
    { label: "Aylık gelir", value: money(ctx.mrr), icon: TrendingUp, tone: "text-mint-400" },
    { label: "Aktif ofis", value: String(ctx.tenantsActive), icon: Building2, tone: "text-brand-400" },
    { label: "Yeni aday", value: String(ctx.newDemos), icon: Handshake, tone: "text-cyan-400" },
    { label: "Açık talep", value: String(ctx.openTickets), icon: LifeBuoy, tone: "text-amber-400" },
  ];

  return (
    <div className="space-y-5">
      <section className="theme-dark relative overflow-hidden rounded-[20px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
        <div className="pointer-events-none absolute -right-14 -top-14 h-52 w-52 rounded-full bg-brand-500/25 blur-[90px]" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <span className="flex items-center gap-2 text-xs font-semibold text-brand-300">
              <Sparkles className="h-4 w-4" /> EmlakSoft · Yapay zeka
            </span>
            <h1 className="mt-2 font-display text-2xl font-extrabold md:text-3xl">Yapay zeka iş danışmanı</h1>
            <p className="mt-1 max-w-xl text-sm text-white/75">
              Platformunuzun canlı verilerine bağlı akıllı danışman. Gelir, müşteri kaybı, satış ve destek üzerine
              somut, uygulanabilir öneriler alın.
            </p>
          </div>
          {staff.role === "super_admin" ? (
            <Link
              href="/admin/sistem"
              className="inline-flex items-center gap-1.5 rounded-[10px] border border-white/15 bg-white/8 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/12"
            >
              <Settings2 className="h-3.5 w-3.5" /> Yapay zeka ayarları
            </Link>
          ) : null}
        </div>
        <div className="relative mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {kpis.map((k) => (
            <div key={k.label} className="rounded-[14px] border border-white/12 bg-white/8 p-3 backdrop-blur">
              <k.icon className={`h-4 w-4 ${k.tone}`} />
              <p className="mt-2 font-display text-xl font-extrabold text-white">{k.value}</p>
              <p className="text-[10px] text-white/70">{k.label}</p>
            </div>
          ))}
        </div>
      </section>

      {!aiEnabled ? (
        <div className="flex items-center gap-3 rounded-[14px] border border-amber-400/30 bg-amber-400/8 px-4 py-3">
          <CreditCard className="h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-sm text-text-muted">
            OpenAI anahtarı tanımlı değil — danışman şu an <strong className="text-ink-950">akıllı yedek</strong> kipinde
            (canlı verilerden kural-tabanlı içgörü) çalışıyor.
            {staff.role === "super_admin" ? (
              <>
                {" "}
                Serbest sohbet için{" "}
                <Link href="/admin/sistem" className="font-semibold text-brand-600 hover:underline">
                  Sistem → Yapay zeka ayarlarından
                </Link>{" "}
                anahtar ekleyin.
              </>
            ) : null}
          </p>
        </div>
      ) : null}

      <AdvisorChat aiEnabled={aiEnabled} />
    </div>
  );
}
