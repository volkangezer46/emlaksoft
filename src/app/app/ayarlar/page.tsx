import Link from "next/link";
import {
  ArrowUpRight,
  CreditCard,
  Fingerprint,
  Plug,
  Radio,
  ScrollText,
  ShieldCheck,
  Sliders,
  Users2,
  Wallet,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { getNotificationPrefs } from "@/app/actions/notification-prefs";
import { CompanyForm } from "./company-form";
import { LogoUploadForm } from "./logo-upload-form";
import { NotificationPrefsPanel } from "@/components/app/notification-prefs";

type SettingCard = {
  title: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: string;
  badge?: string;
  badgeCls?: string;
  href?: string;
};

const SETUP_RING_C = 2 * Math.PI * 42;

const cards: SettingCard[] = [
  { title: "Şube / ekip", desc: "Şubeler, ekipler ve bölge yetkilendirmeleri.", icon: Users2, tone: "bg-cyan-400/12 text-cyan-500", href: "/app/ekip" },
  { title: "Kullanıcı & roller", desc: "Danışman, yönetici ve broker rol izinleri.", icon: Fingerprint, tone: "bg-mint-500/12 text-mint-600", href: "/app/ayarlar/roller" },
  { title: "Tanımlar & seçim listeleri", desc: "Müşteri tipi, kaynak, portföy tipi gibi tüm dropdown seçeneklerini yönetin.", icon: Sliders, tone: "bg-brand-600/10 text-brand-600", badge: "Yeni", badgeCls: "bg-mint-500/12 text-mint-600", href: "/app/ayarlar/tanimlar" },
  { title: "Komisyon defteri", desc: "Hakediş kayıtları, danışman payı ve ödeme bağlantıları.", icon: Wallet, tone: "bg-amber-400/15 text-amber-500", href: "/app/komisyon" },
  { title: "İYS / EİDS", desc: "İzin yönetimi ve elektronik ileti uyumu.", icon: ShieldCheck, tone: "bg-mint-500/12 text-mint-600", badge: "Manuel", badgeCls: "bg-ink-950/8 text-text-muted", href: "/app/uyum" },
  { title: "Abonelik & iyzico", desc: "Paket, fatura ve ödeme yöntemi yönetimi.", icon: CreditCard, tone: "bg-brand-600/10 text-brand-600", badge: "Pro", badgeCls: "bg-brand-600/10 text-brand-600", href: "/app/abonelik" },
  { title: "Değerleme", desc: "Çok kaynaklı fiyat bandı ve ofis emsalleri.", icon: Sliders, tone: "bg-cyan-400/12 text-cyan-500", href: "/app/degerleme" },
  { title: "Raporlar", desc: "Ofis skoru, komisyon ve kayıp-kaçak özeti.", icon: ScrollText, tone: "bg-danger-500/10 text-danger-500", href: "/app/raporlar" },
  { title: "Denetim kayıtları", desc: "Yazma işlemleri ve KVKK erişim günlüğü.", icon: ScrollText, tone: "bg-danger-500/10 text-danger-500", href: "/app/denetim" },
  { title: "Anlaşma pipeline", desc: "Deal board · müzakere → kazanılan.", icon: Wallet, tone: "bg-amber-400/15 text-amber-500", href: "/app/anlasmalar" },
  { title: "Portallar & ilanlar", desc: "Portal ilan bağlama, teyit ve kayıp-kaçak akışı.", icon: Plug, tone: "bg-cyan-400/12 text-cyan-500", href: "/app/portallar" },
  { title: "Aday yakalama", desc: "Web formu/bağlantı, sırayla atama ve hızlı yanıt.", icon: Radio, tone: "bg-mint-500/12 text-mint-600", badge: "Yeni", badgeCls: "bg-mint-500/12 text-mint-600", href: "/app/ayarlar/lead" },
];

export default async function SettingsPage() {
  await requireModulePage("settings");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: tenantRow }, notifPrefs, { count: consentCount }, { count: activeConsentCount }, { count: auditCount }] = await Promise.all([
    supabase
      .from("tenants")
      .select("name, plan, tax_office, tax_number, license_no, brand_color, iban, phone, address_line, city, logo_url, website")
      .limit(1)
      .maybeSingle(),
    getNotificationPrefs(),
    supabase.from("iys_consents").select("id", { count: "exact", head: true }),
    supabase.from("iys_consents").select("id", { count: "exact", head: true }).eq("status", "granted"),
    supabase.from("audit_logs").select("id", { count: "exact", head: true }),
  ]);

  const tenant = tenantRow ?? { name: "", plan: "office", tax_office: null, tax_number: null, license_no: null, brand_color: null, iban: null, phone: null, address_line: null, city: null, logo_url: null, website: null };

  const complianceStrip = [
    {
      label: "İYS izinleri",
      value: (consentCount ?? 0) > 0 ? `${activeConsentCount ?? 0}/${consentCount} onaylı` : "Kayıt yok",
      ok: (consentCount ?? 0) > 0,
    },
    { label: "EİDS kalkanı", value: "Manuel", ok: false },
    {
      label: "Denetim kaydı",
      value: (auditCount ?? 0) > 0 ? `${auditCount} olay` : "Boş",
      ok: (auditCount ?? 0) > 0,
    },
  ];

  const checks = [tenant.name, tenant.tax_office, tenant.tax_number, tenant.license_no, tenant.brand_color, tenant.iban, tenant.phone, tenant.address_line, user?.email];
  const filled = checks.filter(Boolean).length;
  const completion = Math.round((filled / checks.length) * 100);
  const planLabel: Record<string, string> = { advisor: "Danışman", office: "Ofis", professional: "Profesyonel", enterprise: "Kurumsal" };

  return (
    <div className="space-y-6">
      {/* premium header */}
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-14 -top-16 h-60 w-60 rounded-full bg-brand-600/35 blur-[80px]" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="flex items-center gap-2 text-xs font-semibold text-mint-400"><Sliders className="h-4 w-4" /> Ofis yapılandırması</span>
            <h1 className="mt-2 font-display text-2xl font-extrabold text-white md:text-3xl">{tenant.name || "Ayarlar"}</h1>
            <p className="mt-1 text-sm text-white/60">{planLabel[tenant.plan] ?? "Ofis"} planı · ofis, ekip, uyum ve entegrasyonları tek merkezden yönetin.</p>
          </div>
          <div className="relative grid h-28 w-28 place-items-center">
            <div className="conic-spin pointer-events-none absolute inset-2 rounded-full opacity-30 blur-md" style={{ background: "conic-gradient(from 0deg, var(--mint-500), var(--brand-500), var(--mint-500))" }} />
            <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
              <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="8" />
              <circle
                cx="50"
                cy="50"
                r="42"
                fill="none"
                stroke="var(--mint-400)"
                strokeWidth="8"
                strokeLinecap="round"
                className="ring-sweep"
                style={{ "--circ": SETUP_RING_C, "--dash": SETUP_RING_C * (1 - completion / 100) } as React.CSSProperties}
              />
            </svg>
            <div className="absolute text-center">
              <p className="font-display text-xl font-extrabold text-white">%{completion}</p>
              <p className="text-[9px] text-white/55">Kurulum</p>
            </div>
          </div>
        </div>
      </section>

      {/* Logo + company form */}
      <section className="dashboard-panel rounded-[20px] border border-line bg-surface p-6">
        <div className="flex items-center gap-3 border-b border-line pb-4">
          <div>
            <h2 className="font-display font-bold text-ink-950">Marka & kimlik</h2>
            <p className="text-xs text-text-muted">Logo, ofis adı ve iletişim bilgileri</p>
          </div>
        </div>
        <div className="mt-5 border-b border-line pb-5">
          <LogoUploadForm currentUrl={tenant.logo_url ?? null} officeName={tenant.name || "Ofis"} />
        </div>
        <CompanyForm tenant={tenant} />
      </section>

      <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        <NotificationPrefsPanel initial={notifPrefs} />
        <section className="rounded-[20px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
          <h2 className="font-display font-bold text-ink-950">Hızlı bağlantılar</h2>
          <p className="mt-1 text-xs text-text-muted">Operasyon ve uyum kısayolları</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {[
              { href: "/app/anlasmalar", label: "Anlaşma tahtası" },
              { href: "/app/denetim", label: "Denetim" },
              { href: "/app/uyum", label: "İYS / EİDS" },
              { href: "/app/degerleme", label: "Değerleme" },
            ].map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="rounded-[10px] border border-line bg-canvas px-3 py-2 text-xs font-semibold text-brand-600 transition hover:border-brand-300"
              >
                {l.label}
              </Link>
            ))}
          </div>
        </section>
      </div>

      {/* settings grid */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => {
          const inner = (
            <>
              <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-[13px] ${card.tone}`}>
                <card.icon className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="font-display font-bold text-ink-950">{card.title}</h2>
                  {card.badge ? (
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${card.badgeCls}`}>{card.badge}</span>
                  ) : (
                    <ArrowUpRight className="h-4 w-4 text-text-faint transition group-hover:text-brand-600" />
                  )}
                </div>
                <p className="mt-1 text-xs leading-relaxed text-text-muted">{card.desc}</p>
              </div>
            </>
          );
          const cls = "lift group flex items-start gap-4 rounded-[18px] border border-line bg-surface p-5 text-left transition hover:border-brand-300";
          return card.href ? (
            <Link key={card.title} href={card.href} className={cls}>{inner}</Link>
          ) : (
            <button key={card.title} className={cls}>{inner}</button>
          );
        })}
      </div>

      {/* compliance strip */}
      <section className="dashboard-panel flex flex-wrap items-center justify-between gap-4 rounded-[20px] border border-line bg-surface p-5">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-[13px] bg-mint-500/12 text-mint-600"><ShieldCheck className="h-5 w-5" /></span>
          <div>
            <h2 className="font-display font-bold text-ink-950">KVKK & uyum durumu</h2>
            <p className="text-xs text-text-muted">İYS izinleri ve denetim kayıtları canlı verilerden hesaplanır.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {complianceStrip.map((item) => (
            <div key={item.label} className="rounded-[12px] border border-line bg-canvas px-4 py-2.5 text-center">
              <p className="text-[10px] text-text-faint">{item.label}</p>
              <p className={`text-sm font-bold ${item.ok ? "text-mint-600" : "text-amber-600"}`}>{item.value}</p>
            </div>
          ))}
          <Link href="/app/uyum" className="rounded-[10px] bg-ink-950 px-4 py-2.5 text-xs font-semibold text-white hover:bg-ink-800">
            Uyum merkezine git
          </Link>
        </div>
      </section>
    </div>
  );
}
