import Link from "@/components/ui/smart-link";
import { CheckCircle2, Clock, Landmark, MessageSquare, LineChart, Image as ImageIcon, ArrowLeft, CreditCard } from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { listIntegrations, type IntegrationCategory } from "@/lib/integrations/registry";

import { PageHeader } from "@/components/ui/page-header";
export const metadata = { title: "Entegrasyonlar" };

const CATS: { key: IntegrationCategory; label: string; icon: typeof Landmark; sub: string }[] = [
  { key: "resmi", label: "Resmi kayıt & kamu", icon: Landmark, sub: "Yerel sistemlere bağlanmak rakiplerin geçemeyeceği hendek." },
  { key: "iletisim", label: "İletişim kanalları", icon: MessageSquare, sub: "Türkiye'nin fiili kanalı WhatsApp + sosyal aday yakalama." },
  { key: "degerleme", label: "Değerleme & finans", icon: LineChart, sub: "Emsal motorunu ve finansmanı gerçek veriyle besle." },
  { key: "medya", label: "Medya & AI", icon: ImageIcon, sub: "Görsel kalitesini yapay zekâ ile yükselt." },
  { key: "operasyon", label: "Ödeme, fatura & yayın", icon: CreditCard, sub: "Para ve ilan akışlarını doğrulanmış sağlayıcı sözleşmeleriyle yürüt." },
];

export default async function EntegrasyonlarPage() {
  const { tenantId } = await requireModulePage("settings");
  const integrations = await listIntegrations(tenantId);
  const configured = integrations.filter((i) => i.status === "configured").length;

  return (
    <div className="space-y-6">
      <Link href="/app/ayarlar" className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted transition hover:text-brand-600">
        <ArrowLeft className="h-4 w-4" /> Ayarlar
      </Link>

      <PageHeader title="Entegrasyonlar" eyebrow="Bağlantı merkezi" description="Dış servis bağlantılarının ofisinize ait yapılandırma durumunu izleyin. “Yapılandırıldı” yalnız gerekli yerel kimlik ve güvenlik sözleşmesi tamamlandığında gösterilir; sağlayıcı sağlığı işlem anında ayrıca doğrulanır." actions={
<div className="theme-dark flex flex-wrap items-center gap-2 rounded-[var(--radius-card)] bg-[image:var(--grad-ink)] p-2"><div className="rounded-[var(--radius-card)] border border-white/12 bg-white/8 px-5 py-4 text-center">
            <p className="font-display text-3xl font-extrabold">{configured}/{integrations.length}</p>
            <p className="text-xs text-white/60">yapılandırılmış bağlantı</p>
          </div></div>
} />

      {CATS.map((cat) => {
        const items = integrations.filter((i) => i.category === cat.key);
        if (items.length === 0) return null;
        const Icon = cat.icon;
        return (
          <section key={cat.key}>
            <div className="flex items-center gap-2.5">
              <span className="grid h-9 w-9 place-items-center rounded-[var(--radius-control)] bg-brand-600/10 text-brand-600"><Icon className="h-4.5 w-4.5" /></span>
              <div>
                <h2 className="font-display text-base font-bold text-ink-950">{cat.label}</h2>
                <p className="text-xs text-text-muted">{cat.sub}</p>
              </div>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {items.map((it) => {
                const configured = it.status === "configured";
                const planned = it.status === "planned";
                return (
                  <div key={it.key} className="rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)]">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-bold text-ink-950">{it.name}</h3>
                        {it.turkish ? (
                          <span className="rounded-full bg-mint-500/12 px-2 py-0.5 text-xs font-bold text-mint-600 ring-1 ring-inset ring-mint-500/25">TR</span>
                        ) : null}
                      </div>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ring-1 ring-inset ${
                          configured
                            ? "bg-mint-500/12 text-mint-600 ring-mint-500/25"
                            : planned
                              ? "bg-ink-950/6 text-text-muted ring-line"
                              : "bg-amber-400/12 text-amber-600 ring-amber-500/25"
                        }`}
                      >
                        {configured ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
                        {configured ? "Yapılandırıldı" : planned ? "Planlandı" : "Kurulum gerekli"}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-text-muted">{it.description}</p>
                    <div className="mt-3 space-y-1.5 border-t border-line/70 pt-3 text-xs">
                      <p className="flex items-start gap-1.5">
                        <span className="font-semibold text-brand-600">{planned ? "Planlanan:" : "Açar:"}</span>
                        <span className="text-ink-950">{it.unlocks}</span>
                      </p>
                      {!configured ? (
                        <p className="flex items-start gap-1.5 text-text-faint">
                          <span className="font-semibold">Gerekir:</span> {it.requires}
                        </p>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      <p className="rounded-[var(--radius-card)] border border-line bg-canvas/60 px-4 py-3 text-xs text-text-muted">
        Kurulum gerekli durumundaki bağlantılar için kimlik bilgileri ve sağlayıcı doğrulaması tamamlanmalıdır. “Planlandı”
        durumundaki servisler, adaptör ve uçtan uca kabul testleri bitmeden canlı özellik olarak değerlendirilmez.
      </p>
    </div>
  );
}
