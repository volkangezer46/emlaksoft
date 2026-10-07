import Link from "@/components/ui/smart-link";
import { Building2, CreditCard, Hourglass, LifeBuoy, Settings2, Sparkles, TrendingUp } from "lucide-react";
import { requirePlatformModule } from "@/lib/platform";
import { buildAdvisorContext, isAiConfigured } from "@/lib/ai-advisor";
import { AdvisorChat } from "./advisor-chat-lazy";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { KpiCard, KpiGrid } from "@/components/ui/kpi-card";

const money = (n: number) => `₺${Math.round(n).toLocaleString("tr-TR")}`;

export default async function AdvisorPage() {
  const staff = await requirePlatformModule("advisor");
  const [ctx, aiEnabled] = await Promise.all([buildAdvisorContext(), isAiConfigured()]);

  const kpis = [
    { label: "Aylık gelir", value: money(ctx.mrr), icon: TrendingUp, tone: "success" as const, href: "/admin/billing" },
    { label: "Aktif ofis", value: String(ctx.tenantsActive), icon: Building2, tone: "brand" as const, href: "/admin/tenants" },
    { label: "Denemesi bitiyor", value: String(ctx.trialsEndingSoon), icon: Hourglass, tone: "gold" as const, href: "/admin/tenants?deneme=bitiyor" },
    { label: "Açık talep", value: String(ctx.openTickets), icon: LifeBuoy, tone: "warn" as const, href: "/admin/tickets" },
  ];

  return (
    <div className="space-y-5">
      <AdminPageHeader
        eyebrow="EmlakSoft · Yapay zeka"
        icon={Sparkles}
        title="Yapay zeka iş danışmanı"
        description="Platformunuzun canlı verilerine bağlı akıllı danışman. Gelir, müşteri kaybı, deneme hunisi ve destek üzerine somut, uygulanabilir öneriler alın."
        actions={
          staff.role === "super_admin" ? (
            <Link
              href="/admin/sistem"
              className="focus-ring inline-flex min-h-10 items-center gap-1.5 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-xs font-semibold text-ink-950 transition hover:border-brand-400 hover:text-brand-600"
            >
              <Settings2 className="h-3.5 w-3.5" aria-hidden /> Yapay zeka ayarları
            </Link>
          ) : null
        }
      >
        <KpiGrid label="Danışman göstergeleri" className="lg:grid-cols-4 2xl:grid-cols-4">
          {kpis.map((k) => (
            <KpiCard key={k.label} layout="inline" label={k.label} value={k.value} href={k.href} icon={k.icon} tone={k.tone} />
          ))}
        </KpiGrid>
      </AdminPageHeader>

      {!aiEnabled ? (
        <div className="flex items-center gap-3 rounded-[var(--radius-card)] border border-amber-400/30 bg-amber-400/8 px-4 py-3">
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
