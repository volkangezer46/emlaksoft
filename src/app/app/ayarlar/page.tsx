import Link from "next/link";
import {
  ArrowUpRight,
  CheckCircle2,
  CreditCard,
  Crosshair,
  Fingerprint,
  Megaphone,
  Plug,
  Radio,
  ScrollText,
  ShieldCheck,
  Sliders,
  Sparkles,
  Square,
  Trash2,
  UploadCloud,
  Users2,
  Wallet,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { clearSampleDataForm } from "@/app/actions/sample-data";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { getNotificationPrefs } from "@/app/actions/notification-prefs";
import { isNetgsmConfigured } from "@/lib/messaging/netgsm";
import { sanitizeMatchingWeights, type MatchingWeights } from "@/lib/matching";
import { CompanyForm } from "./company-form";
import { MatchingWeightsForm } from "./matching-weights-form";
import { LogoUploadForm } from "./logo-upload-form";
import { IntegrationsForm } from "./integrations-form";
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
  { title: "Duyuru panosu", desc: "Ekibe duyuru yayınlayın, kim okudu takip edin.", icon: Megaphone, tone: "bg-brand-600/10 text-brand-600", badge: "Yeni", badgeCls: "bg-mint-500/12 text-mint-600", href: "/app/ayarlar/duyurular" },
  { title: "Güvenlik", desc: "SMS ile iki adımlı doğrulama ve giriş geçmişi.", icon: ShieldCheck, tone: "bg-mint-500/12 text-mint-600", badge: "Yeni", badgeCls: "bg-mint-500/12 text-mint-600", href: "/app/ayarlar/guvenlik" },
  { title: "Çöp kutusu", desc: "Silinen müşteri ve portföyleri 90 gün içinde geri alın.", icon: Trash2, tone: "bg-danger-500/10 text-danger-500", href: "/app/ayarlar/cop-kutusu" },
  { title: "Tanımlar & seçim listeleri", desc: "Müşteri tipi, kaynak, portföy tipi gibi tüm dropdown seçeneklerini yönetin.", icon: Sliders, tone: "bg-brand-600/10 text-brand-600", badge: "Yeni", badgeCls: "bg-mint-500/12 text-mint-600", href: "/app/ayarlar/tanimlar" },
  { title: "Komisyon defteri", desc: "Hakediş kayıtları, danışman payı ve ödeme bağlantıları.", icon: Wallet, tone: "bg-amber-400/15 text-amber-500", href: "/app/komisyon" },
  { title: "İYS / EİDS", desc: "İzin yönetimi ve elektronik ileti uyumu.", icon: ShieldCheck, tone: "bg-mint-500/12 text-mint-600", badge: "Manuel", badgeCls: "bg-ink-950/8 text-text-muted", href: "/app/uyum" },
  { title: "Abonelik & iyzico", desc: "Paket, fatura ve ödeme yöntemi yönetimi.", icon: CreditCard, tone: "bg-brand-600/10 text-brand-600", badge: "Pro", badgeCls: "bg-brand-600/10 text-brand-600", href: "/app/abonelik" },
  { title: "Değerleme", desc: "Çok kaynaklı fiyat bandı ve ofis emsalleri.", icon: Sliders, tone: "bg-cyan-400/12 text-cyan-500", href: "/app/degerleme" },
  { title: "Raporlar", desc: "Ofis skoru, komisyon ve kayıp-kaçak özeti.", icon: ScrollText, tone: "bg-danger-500/10 text-danger-500", href: "/app/raporlar" },
  { title: "Denetim kayıtları", desc: "Yazma işlemleri ve KVKK erişim günlüğü.", icon: ScrollText, tone: "bg-danger-500/10 text-danger-500", href: "/app/denetim" },
  { title: "Anlaşma hattı", desc: "Anlaşma tahtası · müzakere → kazanılan.", icon: Wallet, tone: "bg-amber-400/15 text-amber-500", href: "/app/anlasmalar" },
  { title: "Portallar & ilanlar", desc: "Portal ilan bağlama, teyit ve kayıp-kaçak akışı.", icon: Plug, tone: "bg-cyan-400/12 text-cyan-500", href: "/app/portallar" },
  { title: "İçe Aktarma", desc: "Excel/CSV'den müşteri ve portföy listelerini sihirbazla taşıyın.", icon: UploadCloud, tone: "bg-brand-600/10 text-brand-600", badge: "Yeni", badgeCls: "bg-mint-500/12 text-mint-600", href: "/app/ice-aktarma" },
  { title: "Aday yakalama", desc: "Web formu/bağlantı, sırayla atama ve hızlı yanıt.", icon: Radio, tone: "bg-mint-500/12 text-mint-600", badge: "Yeni", badgeCls: "bg-mint-500/12 text-mint-600", href: "/app/ayarlar/lead" },
];

export default async function SettingsPage() {
  await requireModulePage("settings");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: tenantRow }, notifPrefs, { count: consentCount }, { count: activeConsentCount }, { count: auditCount }, { data: netgsmRow }, netgsmPlatformConfigured] = await Promise.all([
    supabase
      .from("tenants")
      .select("name, plan, tax_office, tax_number, license_no, brand_color, iban, phone, address_line, city, logo_url, website, sample_seeded_at, matching_weights")
      .limit(1)
      .maybeSingle(),
    getNotificationPrefs(),
    supabase.from("iys_consents").select("id", { count: "exact", head: true }),
    supabase.from("iys_consents").select("id", { count: "exact", head: true }).eq("status", "granted"),
    supabase.from("audit_logs").select("id", { count: "exact", head: true }),
    // Tablo henüz oluşmadıysa error döner, data null kalır — form boş başlar
    supabase.from("tenant_integrations").select("credentials").eq("provider", "netgsm").limit(1).maybeSingle(),
    isNetgsmConfigured(),
  ]);

  const tenant = tenantRow ?? { name: "", plan: "office", tax_office: null, tax_number: null, license_no: null, brand_color: null, iban: null, phone: null, address_line: null, city: null, logo_url: null, website: null, sample_seeded_at: null };
  const sampleSeededAt = (tenant as { sample_seeded_at?: string | null }).sample_seeded_at ?? null;
  // matching_weights null = varsayılan set kullanılıyor; form başlangıcı için güvenli ayrıştır.
  const rawMatchingWeights = (tenant as { matching_weights?: unknown }).matching_weights ?? null;
  const matchingWeights: MatchingWeights | null = rawMatchingWeights
    ? sanitizeMatchingWeights(rawMatchingWeights)
    : null;

  const complianceStrip = [
    {
      label: "İYS izinleri",
      value: (consentCount ?? 0) > 0 ? `${activeConsentCount ?? 0}/${consentCount} onaylı` : "Kayıt yok",
      ok: (consentCount ?? 0) > 0,
      href: "/app/uyum",
    },
    { label: "EİDS kalkanı", value: "Manuel", ok: false, href: "/app/uyum" },
    {
      label: "Denetim kaydı",
      value: (auditCount ?? 0) > 0 ? `${auditCount} olay` : "Boş",
      ok: (auditCount ?? 0) > 0,
      href: "/app/denetim",
    },
  ];

  const netgsmCreds = (netgsmRow?.credentials ?? null) as { usercode?: string; password?: string; msgheader?: string } | null;
  // Şifre client'a asla gitmez — yalnızca var/yok bilgisi
  const netgsm = netgsmCreds && (netgsmCreds.usercode || netgsmCreds.msgheader)
    ? { usercode: netgsmCreds.usercode ?? "", msgheader: netgsmCreds.msgheader ?? "", hasPassword: Boolean(netgsmCreds.password) }
    : null;

  // Kurulum kontrol listesi — ilk madde her zaman tamam (hesap zaten açık),
  // diğerleri tenant/hesap verisinden hesaplanır; eksikler ilgili forma bağlanır.
  const checklist: { label: string; done: boolean; href?: string }[] = [
    { label: "Hesap oluşturuldu", done: true },
    { label: "Ofis adı", done: !!tenant.name, href: "#marka-kimlik" },
    { label: "Vergi dairesi", done: !!tenant.tax_office, href: "#marka-kimlik" },
    { label: "Vergi / TC no", done: !!tenant.tax_number, href: "#marka-kimlik" },
    { label: "Yetki belgesi no", done: !!tenant.license_no, href: "#marka-kimlik" },
    { label: "Marka rengi", done: !!tenant.brand_color, href: "#marka-kimlik" },
    { label: "IBAN", done: !!tenant.iban, href: "#marka-kimlik" },
    { label: "Telefon", done: !!tenant.phone, href: "#marka-kimlik" },
    { label: "Adres", done: !!tenant.address_line, href: "#marka-kimlik" },
    { label: "Hesap e-postası", done: !!user?.email },
  ];
  const doneCount = checklist.filter((c) => c.done).length;
  const completion = Math.round((doneCount / checklist.length) * 100);
  const planLabel: Record<string, string> = { advisor: "Danışman", office: "Ofis", professional: "Profesyonel", enterprise: "Kurumsal" };

  return (
    <div className="space-y-6">
      {/* premium header */}
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-4 text-white md:p-6">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-14 -top-16 h-60 w-60 rounded-full bg-brand-600/35 blur-[80px]" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="flex items-center gap-2 text-xs font-semibold text-mint-400"><Sliders className="h-4 w-4" /> Ofis yapılandırması</span>
            <h1 className="mt-2 font-display text-2xl font-extrabold text-white md:text-3xl">{tenant.name || "Ayarlar"}</h1>
            <p className="mt-1 text-sm text-white/60">{planLabel[tenant.plan] ?? "Ofis"} planı · ofis, ekip, uyum ve entegrasyonları tek merkezden yönetin.</p>
          </div>
          <details className="group/ring text-left">
            <summary
              className="focus-ring block cursor-pointer list-none rounded-full [&::-webkit-details-marker]:hidden"
              title="Eksik kurulum alanlarını görmek için tıklayın"
            >
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
                  <p className="text-[10px] text-white/55">Kurulum</p>
                  <p className="text-[8px] text-mint-400/80 opacity-0 transition group-hover/ring:opacity-100">detay için tıkla</p>
                </div>
              </div>
            </summary>
            <div className="mt-3 w-72 rounded-[14px] border border-white/12 bg-white/8 p-4 backdrop-blur">
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-white/55">
                Kurulum kontrol listesi ({doneCount}/{checklist.length})
              </p>
              <ul className="mt-2.5 space-y-2">
                {checklist.map((item) => (
                  <li key={item.label} className="flex items-center justify-between gap-3 text-xs">
                    <span className="flex min-w-0 items-center gap-2">
                      {item.done ? (
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-mint-400" />
                      ) : (
                        <Square className="h-3.5 w-3.5 shrink-0 text-white/30" />
                      )}
                      <span className={`truncate ${item.done ? "text-white/55" : "text-white/85"}`}>{item.label}</span>
                    </span>
                    {!item.done && item.href ? (
                      <a href={item.href} className="shrink-0 text-[11px] font-semibold text-mint-400 hover:text-mint-300">
                        Tamamla →
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
              {doneCount === checklist.length ? (
                <p className="mt-3 border-t border-white/10 pt-3 text-xs font-semibold text-mint-400">Kurulum tamam 🎉</p>
              ) : null}
            </div>
          </details>
        </div>
      </section>

      {/* Logo + company form */}
      <section id="marka-kimlik" className="dashboard-panel scroll-mt-24 rounded-[20px] border border-line bg-surface p-4 md:p-6">
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

      {/* Eşleştirme ağırlıkları */}
      <section id="eslestirme-agirliklari" className="dashboard-panel scroll-mt-24 rounded-[20px] border border-line bg-surface p-4 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-[13px] bg-cyan-400/12 text-cyan-500"><Crosshair className="h-5 w-5" /></span>
            <div>
              <h2 className="font-display font-bold text-ink-950">Eşleştirme ağırlıkları</h2>
              <p className="text-xs text-text-muted">
                Talep × portföy skorunda hangi kriterin ne kadar önemli olduğunu ofisinize göre ayarlayın.
                {matchingWeights ? " Özel ağırlık seti aktif." : " Varsayılan set kullanılıyor."}
              </p>
            </div>
          </div>
          <Link href="/app/eslestirme" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600">
            Eşleştirme sayfası <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        <MatchingWeightsForm initial={matchingWeights} />
      </section>

      {/* Entegrasyonlar */}
      <section className="dashboard-panel rounded-[20px] border border-line bg-surface p-4 md:p-6">
        <div className="flex items-center gap-3 border-b border-line pb-4">
          <span className="grid h-11 w-11 place-items-center rounded-[13px] bg-cyan-400/12 text-cyan-500"><Plug className="h-5 w-5" /></span>
          <div>
            <h2 className="font-display font-bold text-ink-950">Entegrasyonlar</h2>
            <p className="text-xs text-text-muted">Kampanya SMS gönderimi için ofise özel Netgsm hesabı</p>
          </div>
        </div>
        <div className="mt-5">
          <IntegrationsForm netgsm={netgsm} platformConfigured={netgsmPlatformConfigured} />
        </div>
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
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${card.badgeCls}`}>{card.badge}</span>
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

      {/* Örnek veriler — onboarding seti durumu + kalıcı temizleme */}
      <section className="dashboard-panel flex flex-wrap items-center justify-between gap-4 rounded-[20px] border border-line bg-surface p-5">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-[13px] bg-amber-400/15 text-amber-500">
            <Sparkles className="h-5 w-5" />
          </span>
          <div>
            <h2 className="font-display font-bold text-ink-950">Örnek veriler</h2>
            <p className="text-xs text-text-muted">
              {sampleSeededAt
                ? `Keşif için yüklenen örnek kayıtlar aktif (${new Date(sampleSeededAt).toLocaleDateString("tr-TR")}). Temizleme gerçek kayıtlara dokunmaz.`
                : "Yüklü örnek kayıt yok. Boş ofiste panelden tek tıkla yükleyebilirsiniz."}
            </p>
          </div>
        </div>
        {sampleSeededAt ? (
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-amber-400/15 px-2.5 py-1 text-xs font-bold text-amber-600">Yüklü</span>
            <ConfirmDialog
              trigger={
                <button
                  type="button"
                  className="focus-ring press inline-flex items-center gap-2 rounded-[10px] border border-danger-500/30 bg-danger-500/10 px-4 py-2 text-xs font-semibold text-danger-500 transition hover:bg-danger-500/15"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Örnek verileri temizle
                </button>
              }
              title="Örnek veriler silinsin mi?"
              description="Tüm örnek müşteri, portföy, talep, görev, randevu ve anlaşma kayıtları kalıcı olarak silinir. Gerçek kayıtlarınıza dokunulmaz."
              confirmLabel="Kalıcı sil"
              formAction={clearSampleDataForm}
            />
          </div>
        ) : (
          <span className="rounded-full bg-ink-950/8 px-2.5 py-1 text-xs font-bold text-text-muted">Yüklü değil</span>
        )}
      </section>

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
            <Link
              key={item.label}
              href={item.href}
              className="focus-ring press lift group block rounded-[12px] border border-line bg-canvas px-4 py-2.5 text-center transition hover:border-brand-300"
            >
              <p className="flex items-center justify-center gap-1 text-[11px] text-text-faint">
                {item.label}
                <ArrowUpRight className="hover-action h-3 w-3 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
              </p>
              <p className={`text-sm font-bold ${item.ok ? "text-mint-600" : "text-amber-600"}`}>{item.value}</p>
            </Link>
          ))}
          <Link href="/app/uyum" className="rounded-[10px] bg-ink-950 px-4 py-2.5 text-xs font-semibold text-white hover:bg-ink-800">
            Uyum merkezine git
          </Link>
        </div>
      </section>
    </div>
  );
}
