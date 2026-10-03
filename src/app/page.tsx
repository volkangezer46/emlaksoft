import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Bell,
  Building2,
  CalendarCheck,
  CalendarClock,
  Check,
  CreditCard,
  Database,
  Download,
  FileCheck,
  FileSpreadsheet,
  HandCoins,
  Headphones,
  HelpCircle,
  Landmark,
  Lock,
  MapPin,
  MapPinned,
  MessageCircle,
  PhoneIncoming,
  Radar,
  RefreshCw,
  Scale,
  ShieldCheck,
  Siren,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Pricing } from "@/components/pricing";
import { HeroVisual } from "@/components/marketing/hero-visual";
import { getPlan } from "@/lib/billing/plans";
import { getBaseUrl } from "@/lib/base-url";

/* ------------------------------------------------------------------ */
/* İçerik — yalnızca koddan doğrulanabilir ifadeler                      */
/* ------------------------------------------------------------------ */

// Metin adları yalnızca ilan KAYNAĞINI belirtir; logo yok, entegrasyon iddiası yok.
const portals = ["Sahibinden", "Hepsiemlak", "Emlakjet", "Zingat", "Hürriyet Emlak", "Milliyet Emlak"];

const portalSteps = [
  { icon: FileSpreadsheet, title: "İlan no / URL ekleyin", text: "Portföyünüze portal ilanının numarasını veya bağlantısını kaydedin." },
  { icon: CalendarCheck, title: "Periyodik teyit", text: "Sistem yayın teyidi ister; teyitsiz kalan ilanlar ayrı listelenir." },
  { icon: Siren, title: "Kapanış nedeni", text: "İlan düşünce kapanış formu doldurulur; kaçak ölçülebilir hale gelir." },
];

// Doğrulanan gerçekler: kayıt RPC'si 14 gün deneme açar, kartsız (register-form),
// page-gates deneme boyunca tüm özellikleri açar, vercel.json 27 cron, nav-config 9 başlık.
const facts = [
  { value: "14 gün", label: "ücretsiz deneme", sub: "Tüm özellikler açık" },
  { value: "Kartsız", label: "kayıt", sub: "Kredi kartı istenmez" },
  { value: "27", label: "otomatik görev", sub: "Hatırlatma, teyit, özet" },
  { value: "9", label: "iş başlığı", sub: "Tek menüde, tek panelde" },
];

const questions = [
  { icon: Siren, q: "Hangi ilan neden düştü?", a: "İlan yayından kalkınca kapanış nedeni zorunlu sorulur; satış mı, rakip mi, ihmal mi ayrılır.", href: "#kayip-kacak", cta: "Kayıp-kaçak motoru" },
  { icon: PhoneIncoming, q: "Arayan kimdi, ne istiyordu?", a: "Telefon çalarken müşteri kartı, talebi ve eşleşen portföyler tek ekranda hazır olur.", href: "#akilli-arama", cta: "Akıllı Arama" },
  { icon: HandCoins, q: "Komisyonda kime ne düşüyor?", a: "Bölüşüm, ofis payı ve danışman hakedişi açık kurallarla hesaplanır ve kayıt altına alınır.", href: "#ozellikler", cta: "Komisyon defteri" },
];

const features = [
  { icon: Users, tone: "brand", title: "Müşteri ve talep", text: "Müşteri kartı, talep ve portföy eşleştirme aynı akışta; gelen kutusunda hiçbir talep kaybolmaz." },
  { icon: Building2, tone: "mint", title: "Portföy ve portal teyidi", text: "İlan no/URL takibi, periyodik teyit hatırlatması ve kapanış formu.", href: "#portallar" },
  { icon: CalendarClock, tone: "amber", title: "Randevu ve görev", text: "Randevu, görev ve hatırlatmalar; günlük ve haftalık özetler otomatik hazırlanır." },
  { icon: Wallet, tone: "brand", title: "Anlaşma ve komisyon", text: "Teklif, sözleşme ve SMS onaylı dijital imza; komisyon bölüşümü ve hakediş defteri." },
  { icon: Radar, tone: "danger", title: "Kayıp-kaçak kalkanı", text: "Düşen ilanın nedeni kayda geçer; ay sonunda kaçan komisyon rakamla görünür.", href: "#kayip-kacak", badge: "Profesyonel paket" },
  { icon: Scale, tone: "mint", title: "Değerleme ve uyum", text: "Emsal motoruyla fiyat sinyali; KVKK kayıtları ile İYS/EİDS hazırlık adımları.", href: "#guvenlik" },
] as const;

const toneMap: Record<string, string> = {
  danger: "bg-danger-500/10 text-danger-600",
  mint: "bg-mint-500/12 text-mint-700",
  brand: "bg-brand-600/10 text-brand-700",
  amber: "bg-amber-400/20 text-amber-700",
};

const steps = [
  { icon: Users, title: "Müşteri ve talebi yakalayın", text: "Arayan, WhatsApp ve portföy talepleri tek gelen kutusunda toplanır." },
  { icon: Building2, title: "Portföyü yayınlayın ve izleyin", text: "İlan no/URL ekleyin; teyit hatırlatması ve kapanış formu devreye girer." },
  { icon: Radar, title: "Kaçağı önleyin", text: "İlan düşünce sebep sorulur; rakip mi kapattı, kendi satışınız mı belli olur." },
  { icon: Wallet, title: "Komisyonu kayıt altına alın", text: "Anlaşma kapanınca bölüşüm kurallara göre hesaplanır ve raporlanır." },
];

const integrations = [
  { icon: Landmark, name: "TCMB", desc: "Günlük kur akışı", ready: true },
  { icon: Building2, name: "Portal ilanları", desc: "İlan no/URL takibi", ready: true },
  { icon: FileSpreadsheet, name: "Excel / CSV", desc: "İçe ve dışa aktarma", ready: true },
  { icon: Database, name: "Emsal motoru", desc: "Anahtarsız çalışır", ready: true },
  { icon: CreditCard, name: "iyzico", desc: "Ödeme altyapısı", ready: false },
  { icon: MessageCircle, name: "Netgsm", desc: "SMS gönderimi", ready: false },
  { icon: BarChart3, name: "Endeksa", desc: "Opsiyonel veri bağlantısı", ready: false },
  { icon: MapPinned, name: "Tapusor", desc: "Opsiyonel parsel bağlantısı", ready: false },
];

const security = [
  { icon: Lock, title: "KVKK süreç desteği", text: "Aydınlatma, rıza, dışa aktarım ve silme iş akışları ürünün içinde." },
  { icon: ShieldCheck, title: "Ana veritabanı Frankfurt’ta", text: "Ana uygulama veritabanı, seçili Supabase projesinin Frankfurt (eu-central-1) bölgesinde." },
  { icon: Scale, title: "İYS ve EİDS hazırlığı", text: "KVKK kayıtları ile İYS/EİDS hazırlık adımları görünür süreçlerde." },
  { icon: Download, title: "Veri sahipliği", text: "Verileriniz sizin; istediğiniz an dışa aktarın." },
  { icon: RefreshCw, title: "İşlem geçmişi", text: "Kritik kayıtları dışa aktarın ve işlem geçmişini izleyin." },
  { icon: Users, title: "Rol ve yetki", text: "Danışman, muhasebe ve yönetici erişimi ayrı ayrı tanımlanır." },
];

const faqs = [
  { q: "Deneme için kredi kartı gerekir mi?", a: "Hayır. Kayıt 14 gün ücretsizdir ve kart bilgisi istemez. Deneme boyunca tüm özellikler açıktır; süre sonunda size uygun paketi seçersiniz." },
  { q: "Kurulum ne kadar sürer?", a: "Kayıttan sonra kurulum sihirbazı ofis bilgilerinizi, ekibinizi ve ilk verilerinizi adım adım hazırlar. Süre; kullanıcı sayınıza ve içeri aktaracağınız veriye göre değişir." },
  { q: "Verilerim nerede saklanıyor?", a: "Ana uygulama veritabanı seçili Supabase projesinin Avrupa (Frankfurt / eu-central-1) bölgesinde tutulur. Dosya depolama ve etkinleştirdiğiniz dış hizmetler kendi veri işleme koşullarına tabidir. Yetkilendirme, denetim ve veri yaşam döngüsü araçları sunulur; dilediğiniz an dışa aktarabilirsiniz." },
  { q: "Portal ilanlarımı otomatik çekiyor veya yayınlıyor musunuz?", a: "Hayır. Portallardan izinsiz veri kazımıyoruz ve ilanlarınızı portallara otomatik yayınlamıyoruz. İlan numarası/URL ekliyorsunuz; sistem periyodik teyit ister ve ilan düştüğünde kapanış formuyla kaçağı ölçer." },
  { q: "Dijital imza e-imza mıdır?", a: "Hayır. Sözleşmeler SMS ile doğrulanan dijital imza akışıyla onaylanır; bu bir nitelikli elektronik imza (e-imza) değildir." },
  { q: "Sözleşme veya taahhüt var mı?", a: "Taahhüt yok. Aylık kullanın, istediğiniz an iptal edin. Yıllık ödemede %20 indirim uygulanır." },
  { q: "Mevcut CRM’den geçiş yapabilir miyim?", a: "Evet. Müşteri ve portföylerinizi Excel/CSV ile içeri aktarabilirsiniz. Özel entegrasyon ihtiyaçları teknik değerlendirme sonrasında planlanır." },
];

/* ------------------------------------------------------------------ */
/* Küçük sunum parçaları (hepsi sunucu bileşeni)                         */
/* ------------------------------------------------------------------ */

const SECTION = "mx-auto max-w-6xl px-4 py-16 md:py-24";

function SectionHead({ eyebrow, title, text, tone = "light", align = "center" }: { eyebrow: string; title: React.ReactNode; text?: string; tone?: "light" | "dark"; align?: "center" | "left" }) {
  const dark = tone === "dark";
  return (
    <div className={`max-w-2xl ${align === "center" ? "mx-auto text-center" : ""}`}>
      <span className={`eyebrow ${dark ? "bg-white/10 text-mint-300" : "bg-brand-600/10 text-brand-700"}`}>{eyebrow}</span>
      <h2 className={`mt-4 font-display text-3xl font-extrabold tracking-tight md:text-4xl ${dark ? "text-white" : "text-ink-950"}`}>{title}</h2>
      {text ? <p className={`mt-4 text-base leading-relaxed md:text-lg ${dark ? "text-white/70" : "text-text-muted"}`}>{text}</p> : null}
    </div>
  );
}

function ExampleTag({ dark = false }: { dark?: boolean }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${dark ? "bg-white/10 text-white/80" : "bg-ink-950/5 text-text-muted"}`}>
      Örnek ekran · örnek veri
    </span>
  );
}

export default function HomePage() {
  const baseUrl = getBaseUrl();
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        name: "EmlakSoft",
        url: baseUrl,
        description: "Türkiye emlak ofisleri için abonelikli CRM ve ofis yönetim platformu.",
        areaServed: "TR",
      },
      {
        "@type": "SoftwareApplication",
        name: "EmlakSoft",
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        description: "Müşteri, portföy, randevu, anlaşma ve komisyon akışını tek platformda yöneten emlak ofisi yazılımı. KVKK süreçlerini destekler.",
        offers: { "@type": "Offer", price: String(getPlan("advisor").monthlyTry), priceCurrency: "TRY" },
        inLanguage: "tr-TR",
      },
      {
        "@type": "FAQPage",
        mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
      },
    ],
  };

  return (
    <div className="bg-canvas text-text">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <SiteHeader />

      <main id="main-content">
        {/* ================= HERO ================= */}
        <section className="hero-lux relative overflow-hidden">
          <div className="relative z-10 mx-auto grid max-w-6xl items-center gap-12 px-4 pb-20 pt-10 sm:pt-14 lg:grid-cols-[1fr_1.05fr] lg:gap-6 lg:pb-28 lg:pt-20">
            <div>
              <span className="eyebrow border border-brand-600/15 bg-white/80 text-brand-700 shadow-[var(--shadow-xs)]">
                <span className="h-2 w-2 rounded-full bg-mint-500" aria-hidden="true" />
                Emlak ofisleri için işletim sistemi
              </span>

              <h1 className="mt-6 font-display text-4xl font-extrabold leading-[1.06] tracking-tight text-ink-950 sm:text-5xl lg:text-6xl">
                Emlak işlerinizi{" "}
                <span className="hero-gradient-text block">tek platformda yönetin</span>
              </h1>

              <p className="mt-6 max-w-xl text-lg leading-relaxed text-text-muted">
                Müşteri, portföy, randevu, anlaşma ve komisyon akışı tek panelde. Kayıp-kaçak kalkanı, değerleme ve KVKK araçları aynı yerde.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/kayit"
                  className="btn-shine group inline-flex min-h-12 items-center justify-center gap-2 rounded-[var(--radius-card)] bg-[linear-gradient(120deg,var(--brand-700),var(--brand-600))] px-6 py-3.5 text-base font-semibold text-white shadow-[var(--shadow-glow-brand)] transition hover:brightness-110"
                >
                  14 gün ücretsiz dene <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" aria-hidden="true" />
                </Link>
                <Link
                  href="/demo"
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-[var(--radius-card)] border border-line-strong bg-white px-6 py-3.5 text-base font-semibold text-ink-950 shadow-[var(--shadow-xs)] transition hover:border-brand-400 hover:text-brand-700"
                >
                  <CalendarCheck className="h-4 w-4 text-brand-600" aria-hidden="true" /> Demo görüşmesi planla
                </Link>
              </div>

              <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm text-text-muted">
                {["Kredi kartı gerekmez", "Deneme boyunca tüm özellikler açık", "Taahhütsüz"].map((t) => (
                  <li key={t} className="flex items-center gap-1.5">
                    <Check className="h-4 w-4 text-mint-600" aria-hidden="true" /> {t}
                  </li>
                ))}
              </ul>
            </div>

            <HeroVisual />
          </div>
        </section>

        {/* ================= DOĞRULANABİLİR GERÇEKLER ================= */}
        <section aria-label="Öne çıkan bilgiler" className="relative z-20 mx-auto -mt-10 max-w-6xl px-4 md:-mt-14">
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-hero)] border border-line bg-line shadow-[var(--shadow-card)] md:grid-cols-4">
            {facts.map((f) => (
              <div key={f.label} className="bg-white p-5 md:p-6">
                <dt className="sr-only">{f.label}</dt>
                <dd>
                  <b className="block font-display text-3xl font-extrabold tracking-tight text-ink-950">{f.value}</b>
                  <span className="mt-0.5 block text-sm font-semibold text-ink-800">{f.label}</span>
                  <span className="mt-0.5 block text-xs text-text-muted">{f.sub}</span>
                </dd>
              </div>
            ))}
          </dl>
        </section>

        {/* ================= PORTAL TEYİDİ ================= */}
        <section id="portallar" className="scroll-mt-24">
          <div className={SECTION}>
            <div className="grid items-center gap-10 lg:grid-cols-[.9fr_1.1fr]">
              <div>
                <SectionHead align="left" eyebrow="Portal kontrolü" title="Portal ilanlarınızı tek panelden izleyin" text="EmlakSoft ilanlarınızı portallara yayınlamaz ve veri çekmez; yayında olan ilanınızın numarasını/URL’sini siz eklersiniz, takip ve teyit sistemde yürür." />
                <p className="mt-6 text-sm font-semibold text-ink-800">Takip ettiğiniz ilan kaynakları</p>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {portals.map((p) => (
                    <li key={p} className="rounded-full border border-line bg-white px-3.5 py-1.5 text-sm font-semibold text-ink-800 shadow-[var(--shadow-xs)]">{p}</li>
                  ))}
                </ul>
                <p className="mt-3 max-w-md text-xs leading-relaxed text-text-muted">Marka adları yalnızca ilan kaynağını belirtir. EmlakSoft bu portallarla resmi bir entegrasyon veya ortaklık iddiasında bulunmaz.</p>
              </div>
              <ol className="grid gap-3">
                {portalSteps.map((s, i) => (
                  <li key={s.title} className="flex items-start gap-4 rounded-[var(--radius-panel)] border border-line bg-white p-5 shadow-[var(--shadow-xs)]">
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[var(--radius-card)] bg-brand-600/10 text-brand-700">
                      <s.icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <div>
                      <h3 className="font-display text-base font-bold text-ink-950"><span className="text-brand-600">{i + 1}.</span> {s.title}</h3>
                      <p className="mt-1 text-sm leading-relaxed text-text-muted">{s.text}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* ================= OFİS SAHİBİNİN SORULARI ================= */}
        <section className="border-y border-line bg-white">
          <div className={SECTION}>
            <SectionHead eyebrow="Ofis sahibinin gerçek acıları" title="Üç soruya net cevap" text="Çoğu ofiste cevabı bir kişinin hafızasında ya da dağınık bir tabloda olan sorular." />
            <ul className="mt-12 grid gap-5 md:grid-cols-3">
              {questions.map((q, i) => (
                <li key={q.q} className="lift relative flex flex-col rounded-[var(--radius-panel)] border border-line bg-canvas p-6">
                  <div className="flex items-center justify-between">
                    <span className="grid h-12 w-12 place-items-center rounded-[var(--radius-card)] bg-white text-brand-700 shadow-[var(--shadow-xs)]">
                      <q.icon className="h-6 w-6" aria-hidden="true" />
                    </span>
                    <span className="font-display text-3xl font-extrabold text-ink-950/10" aria-hidden="true">0{i + 1}</span>
                  </div>
                  <h3 className="mt-5 font-display text-xl font-bold text-ink-950">{q.q}</h3>
                  <p className="mt-2 flex-1 text-sm leading-relaxed text-text-muted">{q.a}</p>
                  <a href={q.href} className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:text-brand-600">
                    {q.cta} <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ================= ÖZELLİKLER ================= */}
        <section id="ozellikler" className="scroll-mt-24">
          <div className={SECTION}>
            <SectionHead eyebrow="Tek platform" title="Ofisinizin tüm akışı, altı modülde" text="Menü dokuz iş başlığına ayrılır; her biri aynı müşteri ve portföy kaydını kullanır, veriyi tekrar girmezsiniz." />
            <ul className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {features.map((f) => (
                <li key={f.title} className="lift group relative flex flex-col rounded-[var(--radius-panel)] border border-line bg-white p-6 shadow-[var(--shadow-xs)]">
                  <div className="flex items-start justify-between gap-3">
                    <span className={`grid h-12 w-12 place-items-center rounded-[var(--radius-card)] ${toneMap[f.tone]}`}>
                      <f.icon className="h-6 w-6" aria-hidden="true" />
                    </span>
                    {"badge" in f ? <span className="rounded-full bg-ink-950/5 px-2.5 py-1 text-xs font-semibold text-text-muted">{f.badge}</span> : null}
                  </div>
                  <h3 className="mt-5 font-display text-lg font-bold text-ink-950">{f.title}</h3>
                  <p className="mt-2 flex-1 text-sm leading-relaxed text-text-muted">{f.text}</p>
                  {"href" in f ? (
                    <a href={f.href} aria-label={`${f.title} ayrıntısı`} className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:text-brand-600">
                      Ayrıntı <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
            <p className="mx-auto mt-8 max-w-2xl text-center text-sm text-text-muted">
              Özelliklerin kapsamı pakete göre değişir; 14 günlük deneme boyunca hepsi açıktır. Paket ayrıntıları <a href="#fiyat" className="font-semibold text-brand-700 underline underline-offset-2">fiyatlandırma</a> bölümünde.
            </p>
          </div>
        </section>

        {/* ================= KAYIP-KAÇAK ================= */}
        <section id="kayip-kacak" className="scroll-mt-24 border-y border-line bg-white">
          <div className={SECTION}>
            <div className="grid items-center gap-12 lg:grid-cols-2">
              <div>
                <span className="eyebrow bg-danger-500/10 text-danger-700"><Siren className="h-3.5 w-3.5" aria-hidden="true" /> Kayıp-kaçak motoru</span>
                <h2 className="mt-4 font-display text-3xl font-extrabold tracking-tight text-ink-950 md:text-4xl">Kaybettiğiniz komisyonu rakama dökün</h2>
                <p className="mt-4 text-base leading-relaxed text-text-muted md:text-lg">İlan yayından kalktığında sistem sebebini sorar: satıldı mı, rakip mi kapattı, yoksa ihmal mi edildi? Ay sonunda tahmini kaçan komisyon panonuzda.</p>
                <ul className="mt-6 space-y-3">
                  {["Zorunlu kapanış formu, boş geçilemez", "Rakip kapanışı ile kendi satışınız ayrı sayılır", "Danışman bazında kaçak karnesi"].map((t) => (
                    <li key={t} className="flex items-center gap-3 text-sm text-text">
                      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-mint-500/15"><Check className="h-3 w-3 text-mint-700" aria-hidden="true" /></span>{t}
                    </li>
                  ))}
                </ul>
                <p className="mt-5 text-xs text-text-muted">Profesyonel pakette yer alır; deneme boyunca açıktır.</p>
              </div>

              <div className="relative">
                <div className="rounded-[var(--radius-hero)] border border-line bg-canvas p-5 shadow-[var(--shadow-lg)] md:p-6">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm text-text-muted">Bu ay tahmini kaçan</p>
                      <p className="font-display text-3xl font-extrabold tracking-tight text-danger-600">420.000 ₺</p>
                    </div>
                    <span className="rounded-full bg-danger-500/10 px-2.5 py-1 text-xs font-semibold text-danger-700">8 ilan</span>
                  </div>

                  <div className="mt-5 rounded-[var(--radius-card)] border border-line bg-white p-4">
                    <p className="text-xs font-semibold text-text-muted">Kaçak trendi · son 7 hafta</p>
                    <svg viewBox="0 0 320 88" className="mt-3 h-20 w-full" preserveAspectRatio="none" role="img" aria-label="Örnek kaçak trendi grafiği">
                      <defs>
                        <linearGradient id="leakArea" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#e5484d" stopOpacity="0.25" />
                          <stop offset="100%" stopColor="#e5484d" stopOpacity="0" />
                        </linearGradient>
                      </defs>
                      {[22, 44, 66].map((y) => <line key={y} x1="0" y1={y} x2="320" y2={y} stroke="#0a2247" strokeOpacity="0.07" strokeDasharray="2 5" />)}
                      <path d="M0 16 C30 20 46 26 76 30 S140 44 172 50 S236 66 268 70 S310 78 320 80 L320 88 L0 88 Z" fill="url(#leakArea)" />
                      <path d="M0 16 C30 20 46 26 76 30 S140 44 172 50 S236 66 268 70 S310 78 320 80" fill="none" stroke="#cf3438" strokeWidth="3" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                    </svg>
                  </div>

                  <ul className="mt-4 space-y-2.5">
                    {[
                      { p: "3+1 daire · Onikişubat", d: "Danışman A", s: "Sebep girilmedi", tone: "danger" },
                      { p: "Satılık arsa · Dulkadiroğlu", d: "Danışman B", s: "7 gün teyitsiz", tone: "amber" },
                      { p: "2+1 daire · Onikişubat", d: "Kendi satışı", s: "Kapandı", tone: "mint" },
                    ].map((r) => (
                      <li key={r.p} className="flex items-center justify-between gap-3 rounded-[var(--radius-card)] border border-line bg-white px-4 py-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-ink-950">{r.p}</p>
                          <p className="text-xs text-text-muted">{r.d}</p>
                        </div>
                        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${r.tone === "danger" ? "bg-danger-500/10 text-danger-700" : r.tone === "amber" ? "bg-amber-400/20 text-amber-700" : "bg-mint-500/12 text-mint-700"}`}>{r.s}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-4"><ExampleTag /></div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ================= AKILLI ARAMA ================= */}
        <section id="akilli-arama" className="scroll-mt-24">
          <div className={SECTION}>
            <div className="grid items-center gap-12 lg:grid-cols-2">
              <div className="order-2 lg:order-1">
                <div className="mx-auto max-w-sm rounded-[var(--radius-hero)] border border-line bg-white p-5 shadow-[var(--shadow-lg)] md:p-6">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-semibold text-ink-950">Akıllı Arama</span>
                    <span className="flex items-center gap-1.5 rounded-full bg-mint-500/12 px-2.5 py-1 text-xs font-semibold text-mint-700">
                      <span className="h-2 w-2 rounded-full bg-mint-500" aria-hidden="true" /> Gelen arama
                    </span>
                  </div>
                  <div className="mt-5 flex items-center gap-3">
                    <span className="grid h-12 w-12 place-items-center rounded-full bg-brand-600 font-bold text-white" aria-hidden="true">AY</span>
                    <div>
                      <p className="font-display text-lg font-bold text-ink-950">Ayşe Y.</p>
                      <p className="text-sm text-text-muted">05xx xxx xx xx · Alıcı</p>
                    </div>
                  </div>
                  <ul className="mt-5 space-y-2 text-sm">
                    <li className="rounded-[var(--radius-control)] bg-canvas px-3 py-2.5 text-text">Talep: Onikişubat <b>3+1</b> · 4–6 milyon ₺</li>
                    <li className="rounded-[var(--radius-control)] bg-canvas px-3 py-2.5 text-text"><b>12</b> eşleşen portföy</li>
                    <li className="rounded-[var(--radius-control)] bg-amber-400/20 px-3 py-2.5 font-medium text-amber-700">Son görüşme dün · tekrar aranacak</li>
                  </ul>
                  <div className="mt-5 grid grid-cols-3 gap-2 text-center text-xs font-semibold">
                    <span className="rounded-[var(--radius-control)] bg-mint-500/12 py-2 text-mint-700">Yer göster</span>
                    <span className="rounded-[var(--radius-control)] bg-brand-600/10 py-2 text-brand-700">Not ekle</span>
                    <span className="rounded-[var(--radius-control)] bg-ink-950/5 py-2 text-ink-800">Sonuç kodu</span>
                  </div>
                  <div className="mt-4"><ExampleTag /></div>
                </div>
              </div>
              <div className="order-1 lg:order-2">
                <span className="eyebrow bg-mint-500/12 text-mint-700"><PhoneIncoming className="h-3.5 w-3.5" aria-hidden="true" /> Akıllı Arama</span>
                <h2 className="mt-4 font-display text-3xl font-extrabold tracking-tight text-ink-950 md:text-4xl">Telefon çalarken müşteriyi tanıyın</h2>
                <p className="mt-4 text-base leading-relaxed text-text-muted md:text-lg">Arama kaydında müşteri kartı, talebi, eşleşen portföyler ve önerilen sonuç kodu aynı ekranda hazır olur.</p>
                <ul className="mt-6 grid gap-3 sm:grid-cols-2">
                  {[{ icon: Bell, t: "Anlık müşteri kartı" }, { icon: Building2, t: "Eşleşen portföy" }, { icon: FileCheck, t: "Zorunlu sonuç kodu" }, { icon: MapPin, t: "Bölge ve talep eşleme" }].map((x) => (
                    <li key={x.t} className="flex items-center gap-3 rounded-[var(--radius-card)] border border-line bg-white px-4 py-3">
                      <x.icon className="h-5 w-5 text-brand-600" aria-hidden="true" /><span className="text-sm font-medium text-ink-900">{x.t}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* ================= NASIL ÇALIŞIR ================= */}
        <section id="nasil" className="scroll-mt-24 border-y border-line bg-white">
          <div className={SECTION}>
            <SectionHead eyebrow="Nasıl çalışır" title="Dört adımda kaçan geliri durdurun" text="Kayıttan sonra kurulum sihirbazı ofisinizi adım adım hazırlar." />
            <ol className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
              {steps.map((s, i) => (
                <li key={s.title} className="rounded-[var(--radius-panel)] border border-line bg-canvas p-6">
                  <div className="flex items-center justify-between">
                    <span className="grid h-12 w-12 place-items-center rounded-[var(--radius-card)] bg-white text-brand-700 shadow-[var(--shadow-xs)]">
                      <s.icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <span className="font-display text-3xl font-extrabold text-ink-950/10" aria-hidden="true">0{i + 1}</span>
                  </div>
                  <h3 className="mt-5 font-display text-base font-bold text-ink-950">{s.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-text-muted">{s.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ================= ENTEGRASYONLAR ================= */}
        <section className="scroll-mt-24">
          <div className={SECTION}>
            <SectionHead eyebrow="Bağlantılar" title="Hazır olanlar ve yapılandırma isteyenler" text="Ürün içinde çalışan modüller ile anahtar/hesap gerektiren dış servis bağlayıcıları açıkça ayrılır." />
            <ul className="mt-12 grid grid-cols-2 gap-3 md:grid-cols-4">
              {integrations.map((it) => (
                <li key={it.name} className="rounded-[var(--radius-card)] border border-line bg-white p-4 shadow-[var(--shadow-xs)]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="grid h-10 w-10 place-items-center rounded-[var(--radius-control)] bg-brand-600/10 text-brand-700"><it.icon className="h-5 w-5" aria-hidden="true" /></span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${it.ready ? "bg-mint-500/12 text-mint-700" : "bg-amber-400/20 text-amber-700"}`}>{it.ready ? "Hazır" : "Yapılandırma"}</span>
                  </div>
                  <p className="mt-3 text-sm font-bold text-ink-950">{it.name}</p>
                  <p className="text-xs text-text-muted">{it.desc}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ================= GÜVENLİK ================= */}
        <section id="guvenlik" className="theme-dark scroll-mt-24 bg-[image:var(--grad-ink)] text-white">
          <div className={SECTION}>
            <SectionHead tone="dark" eyebrow="Güven ve uyum" title="Yetki, denetim ve mevzuat süreçleri" text="Veri yaşam döngüsü akışlarını tek yerde yönetin; mevzuat çalışmalarınızı kayıtlarla destekleyin." />
            <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {security.map((s) => (
                <li key={s.title} className="rounded-[var(--radius-panel)] border border-white/10 bg-white/[0.06] p-5">
                  <span className="grid h-11 w-11 place-items-center rounded-[var(--radius-card)] bg-white/10 text-mint-300"><s.icon className="h-5 w-5" aria-hidden="true" /></span>
                  <h3 className="mt-4 font-display text-base font-bold text-white">{s.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-white/70">{s.text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ================= FİYATLANDIRMA ================= */}
        <section id="fiyat" className="scroll-mt-24">
          <div className={SECTION}>
            <SectionHead eyebrow="Şeffaf paketler" title="Gizli maliyet yok, sürpriz yok" text="KDV hariç aylık fiyatlar. Taahhüt yok, dilediğiniz an iptal edin." />
            <Pricing />
          </div>
        </section>

        {/* ================= SSS ================= */}
        <section id="sss" className="scroll-mt-24 border-t border-line bg-white">
          <div className={SECTION}>
            <div className="grid gap-10 lg:grid-cols-[.8fr_1.2fr] lg:items-start">
              <div className="lg:sticky lg:top-28">
                <SectionHead align="left" eyebrow="Sık sorulan sorular" title="Aklınızdaki sorular, net cevaplar" text="Kurulumdan veri güvenliğine kadar en sık karşılaştığımız sorular." />
                <div className="theme-dark mt-6 flex items-center gap-3 rounded-[var(--radius-panel)] bg-[image:var(--grad-ink)] p-5 text-white">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[var(--radius-card)] bg-white/10 text-mint-300"><Headphones className="h-5 w-5" aria-hidden="true" /></span>
                  <div>
                    <p className="text-sm font-bold">Sorunuz hâlâ mı var?</p>
                    <a href="mailto:destek@emlaksoft.com.tr" className="mt-0.5 inline-flex items-center gap-1.5 text-sm font-semibold text-mint-300 hover:underline">destek@emlaksoft.com.tr <ArrowRight className="h-4 w-4" aria-hidden="true" /></a>
                  </div>
                </div>
              </div>
              <div className="space-y-3">
                {faqs.map((f) => (
                  <details key={f.q} className="faq-card group rounded-[var(--radius-card)] border border-line bg-canvas px-5 py-4 transition open:border-brand-300 open:bg-white open:shadow-[var(--shadow-sm)]">
                    <summary className="flex min-h-8 cursor-pointer list-none items-center justify-between gap-4 text-base font-semibold text-ink-950">
                      <span className="flex items-center gap-3"><HelpCircle className="h-4 w-4 shrink-0 text-brand-600" aria-hidden="true" />{f.q}</span>
                      <span aria-hidden="true" className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-line bg-white text-text-muted transition group-open:rotate-45 group-open:border-brand-400 group-open:bg-brand-600 group-open:text-white">+</span>
                    </summary>
                    <p className="mt-3 border-l-2 border-brand-600/20 pl-4 text-sm leading-relaxed text-text-muted">{f.a}</p>
                  </details>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ================= SON CTA ================= */}
        <section className="theme-dark relative overflow-hidden bg-[image:var(--grad-ink)] text-white">
          <div className="pointer-events-none absolute -left-24 top-0 h-80 w-80 rounded-full bg-brand-600/30 blur-[110px]" aria-hidden="true" />
          <div className="pointer-events-none absolute -right-24 bottom-0 h-80 w-80 rounded-full bg-mint-500/20 blur-[110px]" aria-hidden="true" />
          <div className="relative mx-auto max-w-3xl px-4 py-16 text-center md:py-24">
            <h2 className="font-display text-3xl font-extrabold tracking-tight text-white md:text-5xl">Ofisinizde kaybolan fırsatları bugün görün</h2>
            <p className="mx-auto mt-4 max-w-xl text-base text-white/75 md:text-lg">14 gün ücretsiz, kredi kartı gerekmez. Verileriniz size ait; istediğiniz an dışa aktarın.</p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Link href="/kayit" className="btn-shine inline-flex min-h-12 items-center justify-center gap-2 rounded-[var(--radius-card)] bg-white px-7 py-3.5 text-base font-bold text-ink-950 transition hover:bg-white/90">
                Hemen başla <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link href="/demo" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-[var(--radius-card)] border border-white/30 px-7 py-3.5 text-base font-semibold text-white transition hover:bg-white/10">
                Demo görüşmesi planla
              </Link>
            </div>
            <ul className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-white/70">
              <li className="flex items-center gap-2"><Lock className="h-4 w-4" aria-hidden="true" /> KVKK süreç desteği</li>
              <li className="flex items-center gap-2"><TrendingUp className="h-4 w-4" aria-hidden="true" /> Yıllık ödemede %20 indirim</li>
              <li className="flex items-center gap-2"><Check className="h-4 w-4" aria-hidden="true" /> Taahhütsüz</li>
            </ul>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
