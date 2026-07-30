import Link from "next/link";
import { Plug, CheckCircle2, Clock, Landmark, MessageSquare, LineChart, Image as ImageIcon, ArrowLeft } from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { listIntegrations, type IntegrationCategory } from "@/lib/integrations/registry";

export const metadata = { title: "Entegrasyonlar" };

const CATS: { key: IntegrationCategory; label: string; icon: typeof Landmark; sub: string }[] = [
  { key: "resmi", label: "Resmi kayıt & kamu", icon: Landmark, sub: "Yerel sistemlere bağlanmak rakiplerin geçemeyeceği hendek." },
  { key: "iletisim", label: "İletişim kanalları", icon: MessageSquare, sub: "Türkiye'nin fiili kanalı WhatsApp + sosyal lead yakalama." },
  { key: "degerleme", label: "Değerleme & finans", icon: LineChart, sub: "Emsal motorunu ve finansmanı gerçek veriyle besle." },
  { key: "medya", label: "Medya & AI", icon: ImageIcon, sub: "Görsel kalitesini yapay zekâ ile yükselt." },
];

export default async function EntegrasyonlarPage() {
  await requireModulePage("settings");
  const integrations = listIntegrations();
  const connected = integrations.filter((i) => i.status === "connected").length;

  return (
    <div className="space-y-6">
      <Link href="/app/ayarlar" className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted transition hover:text-brand-600">
        <ArrowLeft className="h-4 w-4" /> Ayarlar
      </Link>

      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
        <div className="pointer-events-none absolute -right-14 -top-16 h-56 w-56 rounded-full bg-cyan-500/25 blur-[70px]" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="flex items-center gap-2 text-xs font-semibold text-cyan-300"><Plug className="h-4 w-4" /> Bağlantı merkezi</span>
            <h1 className="mt-2 font-display text-2xl font-extrabold md:text-3xl">Entegrasyonlar</h1>
            <p className="mt-1 max-w-xl text-sm text-white/70">
              Dış servislere açılan tüm bağlantı noktaları. Her kalem anahtar girildiğinde canlıya geçer;
              durumlar gerçek yapılandırmadan okunur.
            </p>
          </div>
          <div className="rounded-[16px] border border-white/12 bg-white/8 px-5 py-4 text-center">
            <p className="font-display text-3xl font-extrabold">{connected}/{integrations.length}</p>
            <p className="text-[11px] text-white/60">bağlı entegrasyon</p>
          </div>
        </div>
      </section>

      {CATS.map((cat) => {
        const items = integrations.filter((i) => i.category === cat.key);
        if (items.length === 0) return null;
        const Icon = cat.icon;
        return (
          <section key={cat.key}>
            <div className="flex items-center gap-2.5">
              <span className="grid h-9 w-9 place-items-center rounded-[11px] bg-brand-600/10 text-brand-600"><Icon className="h-4.5 w-4.5" /></span>
              <div>
                <h2 className="font-display text-base font-bold text-ink-950">{cat.label}</h2>
                <p className="text-xs text-text-muted">{cat.sub}</p>
              </div>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {items.map((it) => {
                const on = it.status === "connected";
                return (
                  <div key={it.key} className="rounded-[16px] border border-line bg-surface p-4 shadow-[var(--shadow-xs)]">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-bold text-ink-950">{it.name}</h3>
                        {it.turkish ? (
                          <span className="rounded-full bg-mint-500/12 px-2 py-0.5 text-[10px] font-bold text-mint-600 ring-1 ring-inset ring-mint-500/25">TR</span>
                        ) : null}
                      </div>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ring-inset ${
                          on
                            ? "bg-mint-500/12 text-mint-600 ring-mint-500/25"
                            : "bg-amber-400/12 text-amber-600 ring-amber-500/25"
                        }`}
                      >
                        {on ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
                        {on ? "Bağlı" : "Bağlantı bekliyor"}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-text-muted">{it.description}</p>
                    <div className="mt-3 space-y-1.5 border-t border-line/70 pt-3 text-xs">
                      <p className="flex items-start gap-1.5">
                        <span className="font-semibold text-brand-600">Açar:</span>
                        <span className="text-ink-950">{it.unlocks}</span>
                      </p>
                      {!on ? (
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

      <p className="rounded-[14px] border border-line bg-canvas/60 px-4 py-3 text-xs text-text-muted">
        Adaptör iskeleleri hazır (<code className="rounded bg-surface px-1">src/lib/integrations/</code>). Bir entegrasyonu
        açmak için ilgili API anahtarını ortam değişkeni olarak girin; kod tarafında ek geliştirme gerekmeden durum
        "Bağlı"ya döner ve ilgili özellik canlıya geçer.
      </p>
    </div>
  );
}
