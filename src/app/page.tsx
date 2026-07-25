import Image from "next/image";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Bath,
  BedDouble,
  Bell,
  Briefcase,
  Building2,
  Check,
  CircleCheck,
  Code2,
  CreditCard,
  Database,
  Download,
  FileCheck,
  Gauge,
  Headphones,
  HelpCircle,
  Landmark,
  Layers,
  Lock,
  MapPin,
  MapPinned,
  MessageCircle,
  Minus,
  PhoneIncoming,
  Quote,
  Radar,
  RefreshCw,
  Ruler,
  Scale,
  Send,
  ShieldCheck,
  Siren,
  Sparkles,
  Star,
  TrendingUp,
  Users,
  Wallet,
  Zap,
} from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { Reveal } from "@/components/reveal";
import { CountUp } from "@/components/count-up";
import { Pricing } from "@/components/pricing";
import { DashboardMock } from "@/components/marketing/dashboard-mock";
import { LiveAnalytics } from "@/components/marketing/live-analytics";
import { IntegrationHub } from "@/components/marketing/integration-hub";

const portals = ["Sahibinden", "Hepsiemlak", "Emlakjet", "Zingat", "Hürriyet Emlak", "Milliyet Emlak"];

const features = [
  { icon: Siren, title: "Kayıp-kaçak motoru", text: "İlan yayından düşünce nedeni zorunlu sorulur. Ay sonunda kaçan komisyonu rakamla görürsünüz.", tone: "danger", span: "lg:col-span-2", metric: { label: "Aylık korunan", value: "₺95B", bars: [40, 55, 48, 68, 60, 82, 95] } },
  { icon: PhoneIncoming, title: "Akıllı Arama OS", text: "Telefon çalınca müşteri kartı, eşleşen portföy ve önerilen sonuç kodu ekranda hazır.", tone: "mint", metric: { label: "Yanıt hızı", value: "-42%", bars: [80, 70, 62, 55, 48, 40, 34] } },
  { icon: TrendingUp, title: "Fiyat vicdanı", text: "TCMB, TÜİK ve kendi verinizle bölgeye göre pahalı/ucuz sinyali.", tone: "brand", metric: { label: "Doğru fiyat", value: "%88", bars: [50, 58, 64, 70, 76, 82, 88] } },
  { icon: Scale, title: "Mevzuat rayı", text: "İYS izin ve EİDS yetki akışı ürünün içinde; ceza riskini azaltın.", tone: "amber", metric: { label: "İYS uyum", value: "%94", bars: [60, 68, 74, 80, 86, 90, 94] } },
  { icon: Wallet, title: "Komisyon & hakediş defteri", text: "Bölüşüm, ofis payı ve danışman hakedişi şeffaf; anlaşmazlık biter.", tone: "brand", metric: { label: "Şeffaflık", value: "%100", bars: [55, 62, 70, 78, 85, 93, 100] } },
];

const toneBar: Record<string, string> = {
  danger: "bg-[linear-gradient(180deg,var(--danger-500),var(--amber-500))]",
  mint: "bg-[linear-gradient(180deg,var(--mint-400),var(--mint-600))]",
  brand: "bg-[linear-gradient(180deg,var(--cyan-400),var(--brand-600))]",
  amber: "bg-[linear-gradient(180deg,var(--amber-400),var(--amber-500))]",
};

const propertyStories = [
  {
    image: "/listing-bosphorus-villa.png",
    label: "PRESTİJ",
    title: "Boğaz manzaralı akıllı villa",
    location: "Bebek, Beşiktaş",
    price: "₺84.500.000",
    rooms: "6+2",
    baths: "5",
    area: "620 m²",
    score: 92,
    signal: "Fiyat dengeli",
    portal: "4 portalda canlı",
  },
  {
    image: "/listing-istanbul-penthouse.png",
    label: "YENİ",
    title: "Panoramik penthouse",
    location: "Ulus, Beşiktaş",
    price: "₺52.750.000",
    rooms: "4+1",
    baths: "3",
    area: "310 m²",
    score: 86,
    signal: "Yüksek talep",
    portal: "3 portalda canlı",
  },
  {
    image: "/listing-aegean-villa.png",
    label: "ÖZEL",
    title: "Ege taş evi ve sonsuzluk havuzu",
    location: "Yalıkavak, Bodrum",
    price: "₺38.900.000",
    rooms: "5+1",
    baths: "4",
    area: "440 m²",
    score: 89,
    signal: "Bölge altında",
    portal: "Yetki doğrulandı",
  },
];

const steps = [
  { icon: Users, title: "Müşteri & talebi yakala", text: "Arayan, WhatsApp ve portföy talepleri tek gelen kutusunda; kayıp yok." },
  { icon: Building2, title: "Portföyü yayınla & izle", text: "İlan no/URL ekleyin; teyit hatırlatması ve kapanış formu otomatik işlesin." },
  { icon: Radar, title: "Kaçağı önle", text: "İlan düşünce sebep sorulur, rakip mi kapattı belli olur." },
  { icon: Wallet, title: "Komisyonu kilitle", text: "Anlaşma kapanınca hakediş otomatik bölüşülür ve raporlanır." },
];

const personas = [
  { icon: Users, title: "Bağımsız danışman", text: "Tek başına çalışıyorsanız bile kurumsal disiplin.", points: ["Akıllı arama kartı", "Kişisel portföy", "Basit komisyon"], fit: 96, scale: "1 kullanıcı" },
  { icon: Building2, title: "Emlak ofisi", text: "2–50 kişilik ekiplerde tam kontrol.", points: ["Rol & yetki", "Kayıp-kaçak panosu", "Komisyon bölüşümü"], fit: 99, scale: "2–50 kullanıcı" },
  { icon: Landmark, title: "Franchise", text: "Çok şube ve merkez finansı tek yerde.", points: ["Şube skorları", "Merkez raporları", "Beyaz etiket"], fit: 94, scale: "Çok şube" },
  { icon: Briefcase, title: "Proje satış", text: "Konut projeleri için stok ve prim akışı.", points: ["Blok/daire stok", "Prim planı", "Bayi yönetimi"], fit: 92, scale: "Proje ekipleri" },
];

type Mark = boolean | "partial";
const comparison: { f: string; es: Mark; reos: Mark; revy: Mark }[] = [
  { f: "Tam Türkçe CRM", es: true, reos: true, revy: "partial" },
  { f: "Portföy + portal takibi", es: true, reos: true, revy: true },
  { f: "Kayıp-kaçak motoru", es: true, reos: false, revy: "partial" },
  { f: "Komisyon & hakediş defteri", es: true, reos: "partial", revy: false },
  { f: "İYS · EİDS · KVKK akışı", es: true, reos: false, revy: false },
  { f: "Şeffaf fiyatlandırma", es: true, reos: false, revy: true },
  { f: "Telefon OS (çoklu platform)", es: true, reos: "partial", revy: false },
  { f: "Franchise & proje modülü", es: true, reos: "partial", revy: false },
];

const integrations = [
  { icon: Landmark, name: "TCMB", desc: "Kur & endeks" },
  { icon: BarChart3, name: "TÜİK", desc: "Bölge verisi" },
  { icon: CreditCard, name: "iyzico", desc: "Abonelik & tahsilat" },
  { icon: MessageCircle, name: "WhatsApp", desc: "Mesaj akışı" },
  { icon: Scale, name: "İYS / EİDS", desc: "İzin & yetki" },
  { icon: Building2, name: "Portallar", desc: "İlan takibi" },
  { icon: Code2, name: "API", desc: "Kendi akışın" },
  { icon: Database, name: "Excel / CSV", desc: "İçe/dışa aktar" },
];

const security = [
  { icon: Lock, title: "KVKK uyumlu", text: "Aydınlatma, rıza ve silme akışları ürünün içinde." },
  { icon: ShieldCheck, title: "AB’de barındırma", text: "Veriler Frankfurt (eu-central-1) bölgesinde." },
  { icon: Scale, title: "İYS & EİDS", text: "İzinli iletişim ve yetki takibi standart." },
  { icon: Download, title: "Veri sahipliği", text: "Verileriniz sizin; istediğiniz an dışa aktarın." },
  { icon: RefreshCw, title: "Otomatik yedek", text: "Günlük yedekleme ve noktada geri dönüş." },
  { icon: Users, title: "Rol & yetki", text: "Danışman, muhasebe, yönetici erişim ayrımı." },
];

const quotes = [
  { role: "Ofis sahibi", tag: "Kahramanmaraş", text: "“Hangi ilan neden düştü, kim ihmal etti göremiyordum. Artık ay sonunda kaçan komisyon rakamla önümde.”" },
  { role: "Bölge müdürü", tag: "3 şube", text: "“Şube skorları ve komisyon bölüşümü şeffaf. Toplantılar tahminle değil veriyle geçiyor.”" },
  { role: "Danışman", tag: "Yatırım uzmanı", text: "“Telefon çalınca müşterinin kim olduğunu, talebini ve eşleşen portföyü anında görüyorum.”" },
];

const faqs = [
  { q: "Kurulum ne kadar sürer?", a: "Kayıt olun, ofis çalışma alanınız anında hazır olur. Demo verilerle 2 dakikada gezmeye başlarsınız; kredi kartı gerekmez." },
  { q: "Verilerim nerede saklanıyor?", a: "Tüm veriler Avrupa (Frankfurt / eu-central-1) bölgesinde, KVKK’ya uygun şekilde barındırılır. Dilediğiniz an dışa aktarabilirsiniz." },
  { q: "Portal ilanlarımı otomatik çekiyor musunuz?", a: "Hayır, izinsiz veri kazımıyoruz. İlan numarası/URL ekliyorsunuz; sistem periyodik teyit ister ve ilan düştüğünde kapanış formuyla kaçağı ölçer." },
  { q: "Sözleşme veya taahhüt var mı?", a: "Taahhüt yok. Aylık kullanın, istediğiniz an iptal edin. Yıllık ödemede %20 indirim uygulanır." },
  { q: "Mevcut CRM’den geçiş yapabilir miyim?", a: "Evet. Müşteri ve portföylerinizi Excel/CSV ile içeri aktarabilirsiniz; Profesyonel ve üzeri pakette API erişimi vardır." },
];

const toneMap: Record<string, string> = {
  danger: "text-danger-500 bg-danger-500/10",
  mint: "text-mint-600 bg-mint-500/12",
  brand: "text-brand-600 bg-brand-600/10",
  amber: "text-amber-500 bg-amber-400/15",
};

function Cell({ v }: { v: boolean | "partial" }) {
  if (v === true)
    return (
      <span className="mx-auto grid h-6 w-6 place-items-center rounded-full bg-mint-500/15">
        <Check className="h-3.5 w-3.5 text-mint-600" />
      </span>
    );
  if (v === "partial")
    return (
      <span className="mx-auto grid h-6 w-6 place-items-center rounded-full bg-amber-400/15">
        <Minus className="h-3.5 w-3.5 text-amber-500" />
      </span>
    );
  return (
    <span className="mx-auto grid h-6 w-6 place-items-center rounded-full bg-ink-950/5">
      <Minus className="h-3.5 w-3.5 text-text-faint" />
    </span>
  );
}

export default function HomePage() {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://emlaksoft.com";
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        name: "EmlakSoft",
        url: baseUrl,
        description: "Türkiye emlak ofisleri için premium abonelikli CRM ve ofis yönetim platformu.",
        areaServed: "TR",
      },
      {
        "@type": "SoftwareApplication",
        name: "EmlakSoft",
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        description: "Müşteriden tapuya, ilandan komisyona kadar emlak ofisinizi tek platformda yönetin. İYS/EİDS uyumlu, yapay zeka destekli emlak CRM.",
        offers: { "@type": "Offer", price: "990", priceCurrency: "TRY" },
        inLanguage: "tr-TR",
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
          <div className="pointer-events-none absolute inset-0 -z-10">
            <div className="hero-aurora" />
            <div className="blob animate-aurora left-[-6%] top-[-8%] h-[420px] w-[420px]" style={{ background: "radial-gradient(circle, rgba(20,99,255,0.5), transparent 70%)" }} />
            <div className="blob animate-float-slow right-[-4%] top-[4%] h-[360px] w-[360px]" style={{ background: "radial-gradient(circle, rgba(34,211,238,0.45), transparent 70%)" }} />
          </div>
          <div className="pointer-events-none absolute inset-0 -z-10 grid-overlay" />
          <div className="pointer-events-none absolute left-[6%] top-36 hidden xl:block">
            <div className="animate-float rounded-[18px] border border-white/80 bg-white/75 p-3.5 shadow-[var(--shadow-card)] backdrop-blur-xl">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-[12px] bg-brand-600/10 text-brand-600"><Users className="h-5 w-5" /></span>
                <div><b className="block font-display text-lg text-ink-950">12</b><span className="text-[11px] text-text-muted">yeni müşteri talebi</span></div>
              </div>
              <div className="mt-3 flex -space-x-2">
                {["AK", "SY", "MO", "+9"].map((x, i) => <span key={x} className={`grid h-7 w-7 place-items-center rounded-full border-2 border-white text-[9px] font-bold ${i === 3 ? "bg-mint-500 text-white" : "bg-ink-800 text-white"}`}>{x}</span>)}
              </div>
            </div>
          </div>
          <div className="pointer-events-none absolute right-[5%] top-44 hidden xl:block">
            <div className="animate-float-slow w-48 rounded-[18px] border border-white/80 bg-white/75 p-4 shadow-[var(--shadow-card)] backdrop-blur-xl">
              <div className="flex items-center justify-between"><span className="grid h-9 w-9 place-items-center rounded-[11px] bg-mint-500/12 text-mint-600"><ShieldCheck className="h-4 w-4" /></span><span className="rounded-full bg-mint-500/10 px-2 py-1 text-[9px] font-bold text-mint-600">UYUMLU</span></div>
              <p className="mt-3 text-[11px] font-semibold text-text-muted">İYS izin sağlığı</p>
              <p className="font-display text-2xl font-extrabold text-ink-950">%94</p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line"><div className="h-full w-[94%] rounded-full bg-[image:var(--grad-brand)]" /></div>
            </div>
          </div>

          <div className="mx-auto max-w-4xl px-4 pb-10 pt-14 text-center lg:pt-20">
            <span className="animate-rise eyebrow border border-line bg-surface/80 text-ink-800 shadow-[var(--shadow-xs)] backdrop-blur">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-mint-500 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-mint-500" />
              </span>
              Türkiye’nin emlak işletim sistemi
            </span>

            <h1 className="animate-rise mt-6 font-display text-4xl font-extrabold leading-[1.04] text-ink-950 sm:text-5xl lg:text-[68px]" style={{ animationDelay: "80ms" }}>
              Emlak ofisinizi baştan sona
              <br className="hidden sm:block" /> <span className="text-gradient">tek platformdan</span> yönetin
            </h1>

            <p className="animate-rise mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-text-muted" style={{ animationDelay: "160ms" }}>
              Müşteri, portföy, komisyon, portal takibi ve kayıp-kaçak — hepsi{" "}
              <span className="font-semibold text-ink-900">İYS/EİDS/KVKK uyumlu</span> tek yerde.
              Bir CRM değil, tam bir işletim sistemi.
            </p>

            <div className="animate-rise mt-8 flex flex-wrap items-center justify-center gap-3" style={{ animationDelay: "240ms" }}>
              <Link href="/kayit" className="btn-shine group inline-flex items-center gap-2 rounded-[12px] bg-[image:var(--grad-brand)] px-6 py-3.5 text-sm font-semibold text-white shadow-[var(--shadow-glow-brand)] transition hover:brightness-[1.06] hover:shadow-[0_24px_60px_-16px_rgba(20,99,255,0.7)]">
                14 gün ücretsiz dene <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
              </Link>
              <Link href="/demo" className="inline-flex items-center gap-2 rounded-[12px] border border-line-strong bg-surface px-6 py-3.5 text-sm font-semibold text-ink-950 transition hover:border-brand-400 hover:text-brand-600">
                Canlı demo izle
              </Link>
            </div>

            <div className="animate-rise mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-text-muted" style={{ animationDelay: "300ms" }}>
              <span className="flex items-center gap-1.5"><Check className="h-4 w-4 text-mint-600" /> Kredi kartı yok</span>
              <span className="flex items-center gap-1.5"><Check className="h-4 w-4 text-mint-600" /> 2 dakikada kurulum</span>
              <span className="flex items-center gap-1.5"><Check className="h-4 w-4 text-mint-600" /> Taahhütsüz</span>
            </div>

            {/* Kurumsal güvence şeridi — gerçek ürün nitelikleri, rafine premium */}
            <div className="animate-rise mx-auto mt-8 flex max-w-3xl flex-wrap items-center justify-center gap-2.5" style={{ animationDelay: "360ms" }}>
              {[
                { icon: Lock, label: "KVKK uyumlu" },
                { icon: FileCheck, label: "İYS & EİDS entegre" },
                { icon: Database, label: "Türkiye veri altyapısı" },
                { icon: Headphones, label: "7/24 uzman destek" },
              ].map((b) => (
                <span
                  key={b.label}
                  className="group inline-flex items-center gap-2 rounded-full border border-line bg-surface/70 px-3.5 py-1.5 text-xs font-semibold text-ink-800 shadow-[var(--shadow-xs)] backdrop-blur transition hover:border-brand-400/60 hover:text-brand-600"
                >
                  <b.icon className="h-3.5 w-3.5 text-brand-600 transition group-hover:scale-110" />
                  {b.label}
                </span>
              ))}
            </div>
          </div>

          {/* big dashboard showcase */}
          <div className="relative mx-auto max-w-5xl px-4 pb-16">
            <div className="pointer-events-none absolute inset-x-10 top-6 -z-10 h-72 glow-conic opacity-70" />
            <Reveal variant="scale">
              <div className="perspective">
                <div className="premium-ring relative">
                  <DashboardMock />
                  {/* floating chips */}
                  <div className="animate-float absolute -left-4 top-10 hidden w-52 rounded-[16px] border border-line bg-surface/90 p-3.5 shadow-[var(--shadow-card)] backdrop-blur md:block">
                    <div className="flex items-center gap-2.5">
                      <span className="pulse-ring grid h-9 w-9 place-items-center rounded-full bg-mint-500 text-white">
                        <PhoneIncoming className="h-4 w-4" />
                      </span>
                      <div>
                        <p className="text-sm font-bold text-ink-950">Ali Kaya</p>
                        <p className="text-[11px] text-text-muted">Gelen arama · Sıcak</p>
                      </div>
                    </div>
                  </div>
                  <div className="animate-float-slow absolute -right-4 bottom-12 hidden w-48 rounded-[16px] border border-line bg-surface/90 p-3.5 shadow-[var(--shadow-card)] backdrop-blur md:block">
                    <div className="flex items-center gap-2 text-amber-500">
                      <Wallet className="h-4 w-4" />
                      <span className="text-[11px] font-semibold">Kaçak önlendi</span>
                    </div>
                    <p className="mt-1 font-display text-xl font-extrabold text-ink-950">
                      <CountUp to={95000} separator suffix=" ₺" />
                    </p>
                    <p className="text-[11px] text-text-muted">Bu hafta korunan</p>
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        {/* ================= LOGOS / PORTAL MARQUEE ================= */}
        <section className="border-y border-line bg-surface">
          <div className="mx-auto max-w-6xl px-4 py-10">
            <p className="text-center text-sm font-medium text-text-muted">
              Portallardaki ilanlarınızı tek panelden izleyin — teyit ve kaçak takibi otomatik
            </p>
            <div className="marquee mt-6">
              <div className="marquee-track gap-4">
                {[...portals, ...portals].map((p, i) => (
                  <div key={`${p}-${i}`} className="flex items-center gap-2 whitespace-nowrap rounded-[12px] border border-line bg-canvas px-5 py-3 text-sm font-semibold text-ink-800">
                    <Layers className="h-4 w-4 text-brand-600" /> {p}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ================= METRICS ================= */}
        <section className="mx-auto max-w-6xl px-4 py-10">
          <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
            {[
              { end: 81, suffix: "", label: "il geneli veri" },
              { end: 6, suffix: " modül", label: "tek platformda" },
              { end: 14, suffix: " gün", label: "kredi kartsız deneme" },
              { end: 20, suffix: "%", label: "yıllık ödeme indirimi" },
            ].map((s) => (
              <Reveal key={s.label} className="text-center">
                <p className="font-display text-4xl font-extrabold md:text-5xl">
                  <span className="text-gradient-static">
                    <CountUp to={s.end} suffix={s.suffix} />
                  </span>
                </p>
                <p className="mt-1 text-sm text-text-muted">{s.label}</p>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ================= EDITORIAL IMAGE STORY ================= */}
        <section className="mx-auto max-w-6xl px-4 pb-12 md:pb-16">
          <Reveal variant="scale">
            <div className="relative overflow-hidden rounded-[30px] bg-[image:var(--grad-ink)] p-2 shadow-[var(--shadow-lg)]">
              <div className="photo-stage theme-dark relative min-h-[520px] overflow-hidden rounded-[24px] md:min-h-[560px]">
                <Image
                  src="/emlaksoft-premium-team.png"
                  alt="EmlakSoft ile operasyon verilerini inceleyen emlak profesyonelleri"
                  fill
                  priority
                  sizes="(max-width: 1200px) 100vw, 1152px"
                  className="object-cover object-center transition duration-[1400ms] hover:scale-[1.025]"
                />
                <div className="photo-copy flex min-h-[520px] max-w-xl flex-col justify-center p-7 text-white md:min-h-[560px] md:p-12">
                  <span className="eyebrow w-fit border border-white/15 bg-white/10 text-cyan-400 backdrop-blur">
                    <Activity className="h-3.5 w-3.5" /> Canlı operasyon merkezi
                  </span>
                  <h2 className="mt-5 font-display text-3xl font-extrabold leading-tight text-white md:text-5xl">
                    Ekibiniz aynı veriye bakar, aynı hedefe yürür
                  </h2>
                  <p className="mt-4 max-w-md text-sm font-medium leading-relaxed text-white/80 md:text-base">
                    Danışman, ofis sahibi ve muhasebe; müşteri yolculuğunu, portföy sağlığını ve komisyonu tek canlı ekranda izler.
                  </p>
                  <div className="mt-7 flex flex-wrap gap-2.5">
                    {["Anlık ekip görünümü", "Şube performansı", "Rol bazlı erişim"].map((x) => (
                      <span key={x} className="flex items-center gap-2 rounded-full border border-white/12 bg-white/10 px-3 py-2 text-xs font-semibold text-white/85 backdrop-blur">
                        <CircleCheck className="h-3.5 w-3.5 text-mint-400" /> {x}
                      </span>
                    ))}
                  </div>
                  <Link href="/kayit" className="btn-shine mt-8 inline-flex w-fit items-center gap-2 rounded-[12px] bg-white px-5 py-3 text-sm font-bold text-ink-950">
                    Ekibini şimdi kur <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>

                <div className="absolute bottom-7 right-7 z-[4] hidden w-64 rounded-[18px] border border-white/20 bg-ink-950/82 p-4 text-white shadow-[var(--shadow-lg)] backdrop-blur-xl md:block">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-white/65">Bu ay dönüşüm</span>
                    <span className="flex items-center gap-1 rounded-full bg-mint-400/15 px-2 py-1 text-[10px] font-bold text-mint-400"><TrendingUp className="h-3 w-3" /> +18%</span>
                  </div>
                  <div className="mt-3 flex items-end justify-between">
                    <b className="font-display text-3xl">₺2,4M</b>
                    <svg viewBox="0 0 110 42" className="h-10 w-28">
                      <defs><linearGradient id="teamLine" x1="0" y1="0" x2="1" y2="0"><stop stopColor="#22d3ee" /><stop offset="1" stopColor="#34d3bd" /></linearGradient></defs>
                      <path className="path-draw" d="M2 35 C15 34 18 26 30 28 S47 19 59 21 S77 10 89 13 S99 5 108 3" fill="none" stroke="url(#teamLine)" strokeWidth="2.5" strokeLinecap="round" />
                    </svg>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 border-t border-white/10 pt-3 text-center">
                    <div><b className="block text-sm">28</b><span className="text-[9px] text-white/45">talep</span></div>
                    <div><b className="block text-sm">11</b><span className="text-[9px] text-white/45">sunum</span></div>
                    <div><b className="block text-sm">4</b><span className="text-[9px] text-white/45">kapanış</span></div>
                  </div>
                </div>
              </div>
            </div>
          </Reveal>
        </section>

        {/* ================= FEATURES BENTO ================= */}
        <section id="ozellikler" className="premium-section mx-auto max-w-6xl px-4 py-12 md:py-16">
          <Reveal className="mx-auto max-w-2xl text-center">
            <span className="eyebrow bg-brand-600/10 text-brand-600"><Sparkles className="h-3.5 w-3.5" /> Ofis sahibinin gerçek acıları için</span>
            <h2 className="mt-4 font-display text-3xl font-bold text-ink-950 md:text-4xl">Bir CRM’den çok daha fazlası</h2>
            <p className="mt-3 text-text-muted">RE-OS ve Revy’nin güçlü yanlarını aldık; üzerine mevzuat, komisyon ve kayıp-kaçak disiplinini ekledik.</p>
          </Reveal>

          <div className="mt-9 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {features.map((f, i) => (
              <Reveal key={f.title} delay={i * 70} className={`feature-rich-card lift group relative overflow-hidden rounded-[22px] border border-line bg-surface p-6 ${f.span ?? ""}`}>
                <f.icon className="pointer-events-none absolute -bottom-5 -right-4 h-32 w-32 text-ink-950/[0.025] transition duration-500 group-hover:-translate-y-2 group-hover:rotate-[-6deg] group-hover:text-brand-600/[0.05]" />
                <div className={`relative mb-5 grid h-12 w-12 place-items-center rounded-[14px] shadow-[var(--shadow-xs)] ${toneMap[f.tone]}`}>
                  <f.icon className="h-6 w-6" />
                </div>
                <h3 className="relative font-display text-lg font-bold text-ink-950">{f.title}</h3>
                <p className="relative mt-2 max-w-xl text-sm leading-relaxed text-text-muted">{f.text}</p>

                {/* live mini metric */}
                <div className="relative mt-5 flex items-end justify-between gap-3 rounded-[12px] border border-line bg-canvas/70 px-3.5 py-3">
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-wide text-text-faint">{f.metric.label}</p>
                    <p className={`font-display text-xl font-extrabold ${f.tone === "danger" ? "text-danger-500" : f.tone === "amber" ? "text-amber-500" : f.tone === "mint" ? "text-mint-600" : "text-brand-600"}`}>{f.metric.value}</p>
                  </div>
                  <div className="flex h-9 items-end gap-[3px]">
                    {f.metric.bars.map((h, bi) => (
                      <span
                        key={bi}
                        className={`bar-live w-[5px] rounded-t-[2px] ${toneBar[f.tone]}`}
                        style={{ height: `${h}%`, animationDelay: `${bi * 80}ms, ${bi * 220}ms` }}
                      />
                    ))}
                  </div>
                </div>

                <div className="relative mt-4 flex items-center justify-between border-t border-line pt-4">
                  <span className="flex items-center gap-1.5 text-[11px] font-semibold text-text-faint"><Zap className="h-3.5 w-3.5 text-amber-500" /> Otomatik iş akışı</span>
                  <span className="inline-flex items-center gap-1 text-sm font-semibold text-brand-600 transition group-hover:translate-x-1">Detay <ArrowUpRight className="h-4 w-4" /></span>
                </div>
              </Reveal>
            ))}
            <Reveal delay={features.length * 70} variant="scale" className="relative overflow-hidden rounded-[20px] bg-[image:var(--grad-ink)] p-6 text-white md:p-7 lg:col-span-3">
              <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-40" />
              <div className="pointer-events-none absolute -right-10 -top-16 h-64 w-64 rounded-full bg-mint-500/20 blur-[100px]" />
              <div className="pointer-events-none absolute -left-10 bottom-[-4rem] h-56 w-56 rounded-full bg-brand-600/25 blur-[100px]" />
              <div className="relative flex flex-col gap-7 md:flex-row md:items-center md:justify-between">
                <div className="flex items-start gap-4">
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[14px] bg-white/10 text-mint-400 shadow-[var(--shadow-xs)]">
                    <Gauge className="h-6 w-6" />
                  </span>
                  <div>
                    <h3 className="font-display text-lg font-bold text-white">Ofis Sağlık Skoru</h3>
                    <p className="mt-1.5 max-w-md text-sm leading-relaxed text-white/70">Teyit, kaçak, dönüşüm ve hakediş tek skorda birleşir; ofisin nabzını her sabah görün.</p>
                    <div className="mt-3.5 flex flex-wrap gap-2">
                      {["Teyit", "Kaçak", "Dönüşüm", "Hakediş"].map((x) => (
                        <span key={x} className="flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[10px] font-semibold text-white/70">
                          <span className="status-pulse h-1.5 w-1.5 rounded-full bg-mint-400" /> {x}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-6 border-t border-white/10 pt-6 md:border-t-0 md:border-l md:pl-8 md:pt-0">
                  <div className="text-center">
                    <div className="flex items-end justify-center gap-1.5">
                      <span className="font-display text-5xl font-extrabold text-mint-400"><CountUp to={78} /></span>
                      <span className="mb-1.5 text-sm text-white/45">/100</span>
                    </div>
                    <p className="mt-1.5 flex items-center justify-center gap-1.5 text-[11px] font-semibold text-mint-400">
                      <TrendingUp className="h-3.5 w-3.5" /> İyi seviye
                    </p>
                  </div>
                  <Link href="/kayit" className="btn-shine inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-[11px] bg-white px-5 py-3 text-sm font-bold text-ink-950 transition hover:bg-white/90">
                    Skorunu gör <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        {/* ================= VERİ ORTAKLARIMIZ: ENDEKSA & TAPUSOR ================= */}
        <section className="border-y border-line bg-surface-2">
          <div className="mx-auto max-w-6xl px-4 py-12 md:py-16">
            <Reveal className="mx-auto max-w-2xl text-center">
              <span className="eyebrow bg-cyan-500/10 text-cyan-700"><Database className="h-3.5 w-3.5" /> Türkiye’nin veri devleriyle entegre</span>
              <h2 className="mt-4 font-display text-3xl font-bold text-ink-950 md:text-4xl">Endeksa &amp; Tapusor gücü, ofisinizde</h2>
              <p className="mt-3 text-text-muted">
                Kendi comps motorumuza ek olarak Endeksa’nın bölgesel fiyat endeksini ve Tapusor’un yapay zeka “EDİ” parsel
                değerlemesini değerleme motoruna ve portföy sayfalarına gömdük.
              </p>
            </Reveal>

            <div className="mt-9 grid gap-5 md:grid-cols-2">
              <Reveal className="feature-rich-card lift group relative overflow-hidden rounded-[22px] border border-line bg-surface p-6">
                <Landmark className="pointer-events-none absolute -bottom-5 -right-4 h-32 w-32 text-cyan-600/[0.05] transition duration-500 group-hover:-translate-y-2 group-hover:text-cyan-600/[0.08]" />
                <div className="relative mb-5 grid h-12 w-12 place-items-center rounded-[14px] bg-cyan-500/10 text-cyan-700 shadow-[var(--shadow-xs)]">
                  <Landmark className="h-6 w-6" />
                </div>
                <h3 className="relative font-display text-lg font-bold text-ink-950">Endeksa bölge endeksi</h3>
                <p className="relative mt-2 max-w-xl text-sm leading-relaxed text-text-muted">
                  Konum ve tipe göre canlı fiyat endeksi, 12 aylık trend ve otomatik değerleme (AVM) — değerleme motoruna
                  ağırlıklı kaynak olarak otomatik eklenir.
                </p>
                <div className="relative mt-5 flex flex-wrap gap-2">
                  {["Bölgesel fiyat endeksi", "AVM değerleme", "12 aylık trend"].map((x) => (
                    <span key={x} className="rounded-full border border-line bg-canvas/70 px-2.5 py-1 text-[11px] font-semibold text-text-muted">{x}</span>
                  ))}
                </div>
              </Reveal>

              <Reveal delay={80} className="feature-rich-card lift group relative overflow-hidden rounded-[22px] border border-line bg-surface p-6">
                <MapPinned className="pointer-events-none absolute -bottom-5 -right-4 h-32 w-32 text-violet-600/[0.05] transition duration-500 group-hover:-translate-y-2 group-hover:text-violet-600/[0.08]" />
                <div className="relative mb-5 grid h-12 w-12 place-items-center rounded-[14px] bg-violet-500/10 text-violet-700 shadow-[var(--shadow-xs)]">
                  <MapPinned className="h-6 w-6" />
                </div>
                <h3 className="relative font-display text-lg font-bold text-ink-950">Tapusor EDİ + yatırım puanı</h3>
                <p className="relative mt-2 max-w-xl text-sm leading-relaxed text-text-muted">
                  Ada/parsel bazlı yapay zeka “EDİ” değerlemesi, 0-100 yatırım puanı ve hukuki/teknik uyarılar — TKGM
                  entegre parsel sorgulamasıyla birlikte.
                </p>
                <div className="relative mt-5 flex flex-wrap gap-2">
                  {["Ada/parsel sorgulama", "EDİ yapay zeka değerleme", "Yatırım puanı"].map((x) => (
                    <span key={x} className="rounded-full border border-line bg-canvas/70 px-2.5 py-1 text-[11px] font-semibold text-text-muted">{x}</span>
                  ))}
                </div>
              </Reveal>
            </div>

            <Reveal delay={140} className="mt-6 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 rounded-[16px] border border-dashed border-line-strong bg-surface px-6 py-5 text-center">
              <span className="text-xs font-semibold text-text-muted">Ayrıca beslenen resmi/kurumsal kaynaklar:</span>
              {["TKGM", "TCMB", "TÜİK", "NVİ"].map((x) => (
                <span key={x} className="flex items-center gap-1.5 text-sm font-bold text-ink-950">
                  <ShieldCheck className="h-3.5 w-3.5 text-mint-600" /> {x}
                </span>
              ))}
            </Reveal>
          </div>
        </section>

        {/* ================= PREMIUM PORTFOLIO VISUALS ================= */}
        <section className="relative overflow-hidden border-y border-line bg-[linear-gradient(180deg,#071a38_0%,#0a2247_100%)] py-12 md:py-16">
          <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
          <div className="pointer-events-none absolute left-[-8%] top-[-20%] h-80 w-80 rounded-full bg-brand-600/25 blur-[100px]" />
          <div className="pointer-events-none absolute bottom-[-25%] right-[-5%] h-80 w-80 rounded-full bg-mint-500/20 blur-[100px]" />
          <div className="theme-dark relative mx-auto max-w-6xl px-4">
            <Reveal className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
              <div className="max-w-2xl">
                <span className="eyebrow border border-white/10 bg-white/8 text-cyan-400"><Building2 className="h-3.5 w-3.5" /> Akıllı portföy vitrini</span>
                <h2 className="mt-4 font-display text-3xl font-extrabold text-white md:text-4xl">Her portföy yalnızca ilan değil,<br className="hidden md:block" /> canlı bir iş sinyali</h2>
                <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/65 md:text-base">Fiyat sağlığı, portal durumu, yetki ve talep yoğunluğu görsel portföy kartında sürekli güncel.</p>
              </div>
              <Link href="/kayit" className="inline-flex w-fit items-center gap-2 rounded-[12px] border border-white/15 bg-white/8 px-5 py-3 text-sm font-semibold text-white backdrop-blur transition hover:border-white/30 hover:bg-white/12">
                Portföy modülünü keşfet <ArrowRight className="h-4 w-4" />
              </Link>
            </Reveal>

            <div className="mt-9 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {propertyStories.map((property, index) => (
                <Reveal key={property.title} delay={index * 90} className="property-card group overflow-hidden rounded-[22px] border border-white/10 bg-white/[0.065] shadow-[0_24px_60px_-30px_rgba(0,0,0,.8)] backdrop-blur">
                  <div className="relative aspect-[4/3] overflow-hidden">
                    <Image src={property.image} alt={property.title} fill sizes="(max-width: 768px) 100vw, 33vw" className="object-cover transition duration-700 group-hover:scale-[1.06]" />
                    <div className="absolute inset-0 bg-gradient-to-t from-ink-950/85 via-transparent to-ink-950/15" />
                    <div className="absolute left-4 top-4 flex items-center gap-2">
                      <span className="rounded-full border border-white/15 bg-ink-950/55 px-2.5 py-1 text-[9px] font-extrabold tracking-[0.14em] text-white backdrop-blur">{property.label}</span>
                      <span className="status-pulse h-2 w-2 rounded-full bg-mint-400" />
                    </div>
                    <div className="absolute right-4 top-4 rounded-[12px] border border-white/15 bg-ink-950/60 px-3 py-2 text-right backdrop-blur">
                      <p className="text-[9px] font-semibold uppercase tracking-wider text-white/50">Portföy skoru</p>
                      <p className="font-display text-xl font-extrabold text-mint-400">{property.score}</p>
                    </div>
                    <div className="absolute inset-x-4 bottom-4">
                      <p className="font-display text-xl font-bold text-white">{property.title}</p>
                      <p className="mt-1 flex items-center gap-1.5 text-xs text-white/70"><MapPin className="h-3.5 w-3.5 text-cyan-400" /> {property.location}</p>
                    </div>
                  </div>
                  <div className="p-5">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-display text-xl font-extrabold text-white">{property.price}</p>
                      <span className="rounded-full bg-mint-400/12 px-2.5 py-1 text-[10px] font-bold text-mint-400">{property.signal}</span>
                    </div>
                    <div className="mt-4 grid grid-cols-3 divide-x divide-white/10 rounded-[12px] border border-white/10 bg-white/[0.035] py-2.5 text-center">
                      <span className="flex items-center justify-center gap-1.5 text-xs text-white/65"><BedDouble className="h-3.5 w-3.5" /> {property.rooms}</span>
                      <span className="flex items-center justify-center gap-1.5 text-xs text-white/65"><Bath className="h-3.5 w-3.5" /> {property.baths}</span>
                      <span className="flex items-center justify-center gap-1.5 text-xs text-white/65"><Ruler className="h-3.5 w-3.5" /> {property.area}</span>
                    </div>
                    <div className="mt-4 flex items-center justify-between text-[11px]">
                      <span className="flex items-center gap-1.5 text-white/45"><CircleCheck className="h-3.5 w-3.5 text-mint-400" /> {property.portal}</span>
                      <span className="font-bold text-cyan-400">Detay →</span>
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ================= HOW IT WORKS ================= */}
        <section id="nasil" className="border-y border-line bg-surface-2">
          <div className="mx-auto max-w-6xl px-4 py-12 md:py-16">
            <Reveal className="mx-auto max-w-2xl text-center">
              <h2 className="font-display text-3xl font-bold text-ink-950 md:text-4xl">Dört adımda kaçan geliri durdurun</h2>
              <p className="mt-3 text-text-muted">Karmaşık kurulum yok. Ekibiniz ilk günden akışa girer.</p>
            </Reveal>
            <div className="relative mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <div className="pointer-events-none absolute left-[10%] right-[10%] top-8 hidden h-[2px] overflow-visible lg:block">
                <div className="h-full w-full bg-gradient-to-r from-transparent via-brand-300/50 to-transparent" />
                <span className="comet absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-brand-500 shadow-[0_0_12px_3px_rgba(20,99,255,0.6)]" />
                <span className="comet absolute top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-mint-400 shadow-[0_0_12px_3px_rgba(52,211,189,0.55)]" style={{ animationDelay: "2.25s" }} />
              </div>
              {steps.map((s, i) => (
                <Reveal key={s.title} delay={i * 110} className="workflow-card group relative overflow-hidden rounded-[18px] border border-line bg-surface p-5 text-left">
                  <s.icon className="pointer-events-none absolute -bottom-5 -right-5 h-28 w-28 text-brand-600/[0.035] transition duration-500 group-hover:-translate-y-2 group-hover:rotate-[-8deg]" />
                  <div className="relative flex items-center justify-between">
                    <div className="grid h-12 w-12 place-items-center rounded-[14px] bg-brand-600/10 text-brand-600 shadow-[var(--shadow-xs)]">
                      <s.icon className="h-5 w-5" />
                    </div>
                    <span className="font-display text-3xl font-extrabold text-ink-950/[0.09]">0{i + 1}</span>
                  </div>
                  <h3 className="relative mt-5 font-display text-base font-bold text-ink-950">{s.title}</h3>
                  <p className="relative mt-2 text-sm leading-relaxed text-text-muted">{s.text}</p>
                  <div className="relative mt-5 flex items-center gap-2 border-t border-line pt-3 text-[10px] font-bold uppercase tracking-[0.1em] text-mint-600">
                    <span className="status-pulse h-1.5 w-1.5 rounded-full bg-mint-500" /> Otomatik işlenir
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ================= LIVE ANALYTICS ================= */}
        <LiveAnalytics />

        {/* ================= DEEP: LEAK ================= */}
        <section className="mx-auto max-w-6xl px-4 py-12 md:py-16">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <Reveal>
              <span className="eyebrow bg-danger-500/10 text-danger-500"><Siren className="h-3.5 w-3.5" /> Kayıp-kaçak motoru</span>
              <h2 className="mt-4 font-display text-3xl font-bold text-ink-950 md:text-4xl">Kaybettiğiniz komisyonu ilk kez rakamla görün</h2>
              <p className="mt-4 text-text-muted">İlan yayından kalktığında sistem sebebini sorar: satıldı mı, rakip mi kapattı, yoksa danışman mı ihmal etti? Ay sonunda “tahmini kaçan komisyon” panosu masanızda.</p>
              <ul className="mt-6 space-y-3">
                {["Zorunlu kapanış formu — boş geçilemez", "Rakip kapanışı vs. kendi satışınız ayrımı", "Danışman bazında kaçak karnesi"].map((t) => (
                  <li key={t} className="flex items-center gap-3 text-sm text-text">
                    <span className="grid h-5 w-5 place-items-center rounded-full bg-mint-500/15"><Check className="h-3 w-3 text-mint-600" /></span>{t}
                  </li>
                ))}
              </ul>
            </Reveal>
            <Reveal variant="scale" className="relative">
              <div className="grad-border p-6 shadow-[var(--shadow-card)]">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-text-muted">Bu ay tahmini kaçan</p>
                    <p className="danger-pulse font-display text-3xl font-extrabold text-danger-500"><CountUp to={420000} separator suffix=" ₺" /></p>
                  </div>
                  <span className="flex items-center gap-1 rounded-full bg-danger-500/10 px-2.5 py-1 text-xs font-semibold text-danger-500"><TrendingUp className="h-3.5 w-3.5" /> 8 ilan</span>
                </div>

                {/* live declining trend */}
                <div className="mt-5 rounded-[14px] border border-line bg-surface-2 p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] font-semibold text-text-muted">Kaçak trendi · son 7 hafta</p>
                    <span className="flex items-center gap-1 rounded-full bg-mint-500/12 px-2 py-0.5 text-[10px] font-bold text-mint-600"><TrendingUp className="h-3 w-3 rotate-180" /> %31 iyileşme</span>
                  </div>
                  <div className="relative mt-3">
                    <svg viewBox="0 0 320 88" className="h-20 w-full" preserveAspectRatio="none" role="img" aria-label="Kaçak trendi grafiği">
                      <defs>
                        <linearGradient id="leakArea" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--danger-500)" stopOpacity="0.28" />
                          <stop offset="100%" stopColor="var(--danger-500)" stopOpacity="0" />
                        </linearGradient>
                        <linearGradient id="leakStroke" x1="0" y1="0" x2="1" y2="0">
                          <stop stopColor="var(--danger-500)" />
                          <stop offset="1" stopColor="var(--amber-500)" />
                        </linearGradient>
                      </defs>
                      {[22, 44, 66].map((y) => <line key={y} x1="0" y1={y} x2="320" y2={y} stroke="rgba(10,34,71,0.05)" strokeWidth="1" strokeDasharray="2 5" />)}
                      <path d="M0 16 C30 20 46 26 76 30 S140 44 172 50 S236 66 268 70 S310 78 320 80 L320 88 L0 88 Z" fill="url(#leakArea)" />
                      <path className="chart-draw" style={{ "--len": "420" } as React.CSSProperties} d="M0 16 C30 20 46 26 76 30 S140 44 172 50 S236 66 268 70 S310 78 320 80" fill="none" stroke="url(#leakStroke)" strokeWidth="3" strokeLinecap="round" />
                      <path className="trace-flow" d="M0 16 C30 20 46 26 76 30 S140 44 172 50 S236 66 268 70 S310 78 320 80" fill="none" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" opacity="0.6" />
                      <circle className="glow-halo" cx="320" cy="80" r="5" fill="var(--mint-500)" />
                      <circle className="glow-dot" cx="320" cy="80" r="4" fill="#fff" stroke="var(--mint-500)" strokeWidth="2" />
                    </svg>
                  </div>
                </div>

                <div className="mt-4 space-y-3">
                  {[
                    { p: "Hepsiemlak #99211", d: "Merve A.", s: "Sebep yok", tone: "danger" },
                    { p: "Sahibinden #128874", d: "Ahmet Y.", s: "7 gün teyitsiz", tone: "amber" },
                    { p: "Emlakjet #55120", d: "Kendi satış", s: "Kapandı ✓", tone: "mint" },
                  ].map((r) => (
                    <div key={r.p} className="flex items-center justify-between rounded-[12px] border border-line bg-surface-2 px-4 py-3">
                      <div>
                        <p className="text-sm font-semibold text-ink-950">{r.p}</p>
                        <p className="text-xs text-text-faint">Danışman: {r.d}</p>
                      </div>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${r.tone === "danger" ? "bg-danger-500/10 text-danger-500" : r.tone === "amber" ? "bg-amber-400/15 text-amber-500" : "bg-mint-500/12 text-mint-600"}`}>{r.s}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="pointer-events-none absolute -right-6 -top-6 -z-10 h-40 w-40 rounded-full bg-danger-500/20 blur-3xl" />
            </Reveal>
          </div>
        </section>

        {/* ================= DEEP: PHONE ================= */}
        <section className="border-y border-line bg-surface-2">
          <div className="mx-auto max-w-6xl px-4 py-12 md:py-16">
            <div className="grid items-center gap-12 lg:grid-cols-2">
              <Reveal variant="scale" className="order-2 lg:order-1">
                <div className="relative mx-auto max-w-sm">
                  <div className="grad-border overflow-hidden p-6 shadow-[var(--shadow-lg)]">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-semibold text-ink-950">Akıllı Arama</span>
                      <span className="flex items-center gap-1.5 rounded-full bg-mint-500/12 px-2.5 py-1 text-xs font-semibold text-mint-600">
                        <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-mint-500 opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-mint-500" /></span>
                        Gelen arama
                      </span>
                    </div>
                    <div className="mt-5 flex items-center gap-3">
                      <span className="pulse-ring grid h-12 w-12 place-items-center rounded-full bg-brand-600 font-bold text-white">AK</span>
                      <div><p className="font-display text-lg font-bold text-ink-950">Ali Kaya</p><p className="text-sm text-text-muted">0532 000 00 00 · Alıcı · Sıcak</p></div>
                    </div>

                    {/* live call waveform */}
                    <div className="mt-5 flex items-center gap-3 rounded-[12px] border border-mint-500/25 bg-mint-500/5 px-3 py-2.5">
                      <span className="flex items-center gap-1 text-[11px] font-semibold text-mint-600">
                        <span className="status-pulse h-2 w-2 rounded-full bg-mint-500" /> Canlı
                      </span>
                      <div className="flex h-8 flex-1 items-center justify-between gap-[3px]">
                        {[40, 70, 30, 90, 55, 75, 35, 85, 50, 65, 45, 95, 60, 80, 38, 72, 48, 88, 42, 68].map((h, i) => (
                          <span
                            key={i}
                            className="wave-bar w-full max-w-[4px] flex-1 rounded-full bg-[linear-gradient(180deg,var(--mint-400),var(--brand-600))]"
                            style={{ height: `${h}%`, animationDelay: `${(i % 6) * 0.12}s` }}
                          />
                        ))}
                      </div>
                      <span className="font-mono text-[11px] font-semibold tabular-nums text-ink-800">01:24</span>
                    </div>

                    <div className="mt-4 space-y-2 text-sm">
                      <div className="rounded-[10px] bg-surface-2 px-3 py-2.5 text-text">Talep: Onikişubat <b>3+1</b> · 4–6M ₺</div>
                      <div className="rounded-[10px] bg-surface-2 px-3 py-2.5 text-text"><b>12</b> eşleşen portföy · Fiyat sağlığı <span className="text-mint-600">yeşil</span></div>
                      <div className="rounded-[10px] bg-amber-400/15 px-3 py-2.5 font-medium text-amber-500">Son görüşme: Dün · Tekrar aranacak</div>
                    </div>
                    <div className="mt-5 grid grid-cols-3 gap-2 text-center text-xs font-semibold">
                      <span className="rounded-[10px] bg-mint-500/12 py-2 text-mint-600">Yer göster</span>
                      <span className="rounded-[10px] bg-brand-600/10 py-2 text-brand-600">Not ekle</span>
                      <span className="rounded-[10px] bg-ink-950/5 py-2 text-ink-800">Sonuç kodu</span>
                    </div>
                  </div>
                </div>
              </Reveal>
              <Reveal className="order-1 lg:order-2">
                <span className="eyebrow bg-mint-500/12 text-mint-600"><PhoneIncoming className="h-3.5 w-3.5" /> Akıllı Arama OS</span>
                <h2 className="mt-4 font-display text-3xl font-bold text-ink-950 md:text-4xl">Telefon çalarken müşteriyi tanıyın</h2>
                <p className="mt-4 text-text-muted">Rakip “telefon çalınca CRM açılır” diyor ama yalnızca Android’de. Biz aramayı bir işletim sistemine çeviriyoruz: kart, eşleşen portföy ve önerilen sonuç kodu tek ekranda.</p>
                <div className="mt-6 grid grid-cols-2 gap-4">
                  {[{ icon: Bell, t: "Anlık müşteri kartı" }, { icon: Building2, t: "Eşleşen portföy" }, { icon: FileCheck, t: "Zorunlu sonuç kodu" }, { icon: MapPin, t: "Bölge & talep eşleme" }].map((x) => (
                    <div key={x.t} className="flex items-center gap-3 rounded-[12px] border border-line bg-surface px-4 py-3">
                      <x.icon className="h-5 w-5 text-brand-600" /><span className="text-sm font-medium text-ink-900">{x.t}</span>
                    </div>
                  ))}
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        {/* ================= PERSONAS ================= */}
        <section className="mx-auto max-w-6xl px-4 py-12 md:py-16">
          <Reveal className="mx-auto max-w-2xl text-center">
            <span className="eyebrow bg-brand-600/10 text-brand-600"><Users className="h-3.5 w-3.5" /> Kimler için</span>
            <h2 className="mt-4 font-display text-3xl font-bold text-ink-950 md:text-4xl">Danışmandan franchise’a kadar</h2>
            <p className="mt-3 text-text-muted">Tek kişilik ofiste de, 50 şubeli yapıda da aynı disiplin.</p>
          </Reveal>
          <div className="mt-9 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
            {personas.map((p, i) => (
              <Reveal key={p.title} delay={i * 80} className="persona-card lift group relative overflow-hidden rounded-[20px] border border-line bg-surface p-6">
                <p.icon className="pointer-events-none absolute -right-5 -top-5 h-32 w-32 text-brand-600/[0.035] transition duration-500 group-hover:scale-110 group-hover:rotate-6" />
                <div className="relative flex items-center justify-between">
                  <div className="grid h-12 w-12 place-items-center rounded-[14px] bg-brand-600/10 text-brand-600 shadow-[var(--shadow-xs)]"><p.icon className="h-6 w-6" /></div>
                  <span className="rounded-full bg-canvas px-2.5 py-1 text-[9px] font-extrabold tracking-[0.12em] text-text-faint">0{i + 1}</span>
                </div>
                <h3 className="relative mt-5 font-display text-lg font-bold text-ink-950">{p.title}</h3>
                <p className="relative mt-1 text-sm text-text-muted">{p.text}</p>
                <ul className="relative mt-4 space-y-2">
                  {p.points.map((pt) => (
                    <li key={pt} className="flex items-center gap-2 text-sm text-text"><Check className="h-4 w-4 text-mint-600" /> {pt}</li>
                  ))}
                </ul>
                <div className="relative mt-5 border-t border-line pt-4">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-semibold text-text-faint">Uygunluk</span>
                    <span className="font-display font-bold text-mint-600">%{p.fit}</span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-canvas">
                    <div className="pipeline-fill h-full rounded-full bg-[image:var(--grad-brand)]" style={{ width: `${p.fit}%`, animationDelay: `${i * 120}ms` }} />
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-text-faint">{p.scale}</span>
                    <ArrowUpRight className="h-4 w-4 text-brand-600 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ================= COMPARISON ================= */}
        <section id="karsilastirma" className="border-y border-line bg-surface-2">
          <div className="mx-auto max-w-5xl px-4 py-12 md:py-16">
            <Reveal className="mx-auto max-w-2xl text-center">
              <span className="eyebrow bg-mint-500/12 text-mint-600"><Scale className="h-3.5 w-3.5" /> Karşılaştırma</span>
              <h2 className="mt-4 font-display text-3xl font-bold text-ink-950 md:text-4xl">Neden EmlakSoft?</h2>
              <p className="mt-3 text-text-muted">Rakiplerin güçlü yanlarını kapsayıp eksik kalınan yerleri tamamlıyoruz.</p>
            </Reveal>
            <Reveal className="mt-10 overflow-hidden rounded-[18px] border border-line bg-surface">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-line">
                      <th className="px-5 py-4 font-medium text-text-muted">Özellik</th>
                      <th className="px-3 py-4 text-center">
                        <span className="inline-flex items-center gap-1.5 font-display font-bold text-brand-600"><span className="grid h-6 w-6 place-items-center rounded-[7px] bg-[image:var(--grad-brand)] text-[11px] font-bold text-white">E</span>EmlakSoft</span>
                      </th>
                      <th className="px-3 py-4 text-center font-semibold text-text-muted">RE-OS</th>
                      <th className="px-3 py-4 text-center font-semibold text-text-muted">Revy</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparison.map((row, i) => (
                      <tr key={row.f} className={i % 2 ? "bg-surface-2/60" : ""}>
                        <td className="px-5 py-3.5 font-medium text-ink-950">{row.f}</td>
                        <td className="px-3 py-3.5"><Cell v={row.es} /></td>
                        <td className="px-3 py-3.5"><Cell v={row.reos} /></td>
                        <td className="px-3 py-3.5"><Cell v={row.revy} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Reveal>
            <p className="mt-3 text-center text-xs text-text-faint">Karşılaştırma; kamuya açık ürün konumlandırmalarına dayalı genel değerlendirmedir.</p>
          </div>
        </section>

        {/* ================= INTEGRATIONS ================= */}
        <section className="theme-dark relative overflow-hidden bg-[image:var(--grad-ink)] py-12 text-white md:py-16">
          <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
          <div className="pointer-events-none absolute left-[-6%] top-1/2 h-80 w-80 -translate-y-1/2 rounded-full bg-brand-600/20 blur-[110px]" />
          <div className="pointer-events-none absolute right-[-4%] top-1/3 h-72 w-72 rounded-full bg-mint-500/15 blur-[110px]" />
          <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-4 lg:grid-cols-[1fr_1.05fr]">
            <Reveal>
              <span className="eyebrow border border-white/10 bg-white/8 text-cyan-400"><Layers className="h-3.5 w-3.5" /> Entegrasyonlar</span>
              <h2 className="mt-4 font-display text-3xl font-extrabold text-white md:text-4xl">Kullandığınız kaynaklarla<br className="hidden md:block" /> tek merkezden konuşur</h2>
              <p className="mt-3 max-w-md text-sm leading-relaxed text-white/65 md:text-base">Veri kaynakları, ödeme ve iletişim kanalları EmlakSoft çekirdeğine canlı bağlanır; veriler tek akışta, gerçek zamanlı senkron.</p>
              <div className="mt-7 grid grid-cols-2 gap-2.5 sm:grid-cols-2">
                {integrations.map((it) => (
                  <div key={it.name} className="integration-card group relative flex items-center gap-3 overflow-hidden rounded-[14px] border border-white/10 bg-white/[0.05] p-3 backdrop-blur transition hover:border-white/25">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px] bg-white/8 text-cyan-400 transition group-hover:scale-110"><it.icon className="h-4 w-4" /></span>
                    <div className="min-w-0"><p className="truncate text-sm font-bold text-white">{it.name}</p><p className="truncate text-[11px] text-white/50">{it.desc}</p></div>
                    <span className="status-pulse absolute right-2.5 top-2.5 h-1.5 w-1.5 rounded-full bg-mint-400" />
                  </div>
                ))}
              </div>
            </Reveal>
            <Reveal variant="scale" className="flex justify-center">
              <IntegrationHub />
            </Reveal>
          </div>
        </section>

        {/* ================= SECURITY ================= */}
        <section className="theme-dark relative overflow-hidden bg-[image:var(--grad-ink)] py-12 text-white md:py-16">
          <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-40" />
          <div className="relative mx-auto max-w-6xl px-4">
            <Reveal className="mx-auto max-w-2xl text-center">
              <span className="eyebrow bg-white/10 text-mint-400"><ShieldCheck className="h-3.5 w-3.5" /> Güven & uyum</span>
              <h2 className="mt-4 font-display text-3xl font-bold text-white md:text-4xl">Kurumsal güvenlik, Türkiye mevzuatı</h2>
              <p className="mt-3 text-white/70">Verileriniz AB’de, uyum akışları ürünün içinde. Ceza riskini azaltın, güveni artırın.</p>
            </Reveal>
            <div className="mt-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {security.map((s, i) => (
                <Reveal key={s.title} delay={i * 60} className="group relative overflow-hidden rounded-[18px] border border-white/10 bg-white/5 p-5 backdrop-blur transition duration-500 hover:-translate-y-1 hover:border-white/25 hover:bg-white/[0.08]">
                  <div className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-mint-500/10 opacity-0 blur-2xl transition duration-500 group-hover:opacity-100" />
                  <div className="shield-ring relative grid h-11 w-11 place-items-center rounded-[12px] bg-white/10 text-mint-400">
                    <s.icon className="relative z-10 h-5 w-5 transition duration-500 group-hover:scale-110" />
                  </div>
                  <h3 className="relative mt-4 font-display text-base font-bold text-white">{s.title}</h3>
                  <p className="relative mt-1 text-sm text-white/65">{s.text}</p>
                  <span className="relative mt-4 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-mint-400 opacity-0 transition duration-500 group-hover:opacity-100">
                    <span className="status-pulse h-1.5 w-1.5 rounded-full bg-mint-400" /> Aktif koruma
                  </span>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ================= QUOTES ================= */}
        <section className="mx-auto max-w-6xl px-4 py-12 md:py-16">
          <Reveal className="mx-auto max-w-2xl text-center">
            <span className="eyebrow bg-amber-400/15 text-amber-500"><Quote className="h-3.5 w-3.5" /> Tanıdık geldi mi?</span>
            <h2 className="mt-4 font-display text-3xl font-bold text-ink-950 md:text-4xl">Sahadaki en sık dertler</h2>
            <p className="mt-3 text-text-muted">EmlakSoft tam da bu senaryolar için kuruldu.</p>
          </Reveal>
          <div className="mt-9 grid gap-5 md:grid-cols-3">
            {quotes.map((q, i) => (
              <Reveal key={q.role} delay={i * 90} className="quote-card lift relative flex flex-col overflow-hidden rounded-[20px] border border-line bg-surface p-6">
                <Quote className="pointer-events-none absolute -right-3 -top-4 h-28 w-28 text-brand-600/[0.045]" />
                <div className="relative flex items-center justify-between">
                  <div className="flex items-center gap-1 text-amber-400">{Array.from({ length: 5 }).map((_, j) => (<Star key={j} className="h-4 w-4 fill-current" />))}</div>
                  <span className="rounded-full bg-mint-500/10 px-2 py-1 text-[9px] font-bold text-mint-600">DOĞRULANDI</span>
                </div>
                <p className="relative mt-5 flex-1 text-sm font-medium leading-relaxed text-text">{q.text}</p>
                <div className="relative mt-5 flex items-center gap-3 border-t border-line pt-4">
                  <span className="grid h-10 w-10 place-items-center rounded-full bg-[image:var(--grad-brand)] text-xs font-bold text-white shadow-[var(--shadow-xs)]">{q.role[0]}</span>
                  <div><p className="text-sm font-semibold text-ink-950">{q.role}</p><p className="text-xs text-text-faint">{q.tag}</p></div>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ================= PRICING ================= */}
        <section id="fiyat" className="border-y border-line bg-surface-2">
          <div className="mx-auto max-w-6xl px-4 py-12 md:py-16">
            <Reveal className="mx-auto max-w-2xl text-center">
              <span className="eyebrow bg-brand-600/10 text-brand-600"><Wallet className="h-3.5 w-3.5" /> Şeffaf paketler</span>
              <h2 className="mt-4 font-display text-3xl font-bold text-ink-950 md:text-4xl">Gizli maliyet yok, sürpriz yok</h2>
              <p className="mt-3 text-text-muted">KDV hariç aylık fiyatlar. Dilediğiniz an iptal edin.</p>
            </Reveal>
            <Reveal><Pricing /></Reveal>
          </div>
        </section>

        {/* ================= FAQ ================= */}
        <section id="sss" className="mx-auto max-w-6xl px-4 py-12 md:py-16">
          <div className="grid gap-8 lg:grid-cols-[.72fr_1.28fr] lg:items-start">
            <Reveal className="lg:sticky lg:top-28">
              <span className="eyebrow bg-brand-600/10 text-brand-600"><HelpCircle className="h-3.5 w-3.5" /> Yardım merkezi</span>
              <h2 className="mt-4 font-display text-3xl font-bold text-ink-950 md:text-4xl">Aklınızdaki sorular, net cevaplar</h2>
              <p className="mt-3 max-w-sm text-sm leading-relaxed text-text-muted">Kurulumdan veri güvenliğine kadar en sık karşılaştığımız soruları yanıtladık.</p>
              <div className="theme-dark relative mt-6 overflow-hidden rounded-[18px] bg-[image:var(--grad-ink)] p-5 text-white shadow-[var(--shadow-card)]">
                <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
                <div className="relative flex items-center gap-3">
                  <span className="grid h-11 w-11 place-items-center rounded-[13px] bg-white/10 text-mint-400"><Headphones className="h-5 w-5" /></span>
                  <div><p className="text-sm font-bold text-white">Sorunuz hâlâ mı var?</p><p className="text-xs text-white/55">Uzman ekibimiz yanıtlasın.</p></div>
                </div>
                <Link href="mailto:destek@emlaksoft.com.tr" className="relative mt-4 inline-flex items-center gap-2 text-sm font-semibold text-mint-400">Bize ulaşın <ArrowRight className="h-4 w-4" /></Link>
              </div>
            </Reveal>
            <div className="space-y-3">
              {faqs.map((f, i) => (
                <Reveal key={f.q} delay={i * 50}>
                  <details className="faq-card group rounded-[16px] border border-line bg-surface px-5 py-4 transition open:border-brand-300 open:shadow-[var(--shadow-sm)]">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-semibold text-ink-950">
                      <span className="flex items-center gap-3"><span className="text-xs font-extrabold text-brand-600/50">0{i + 1}</span>{f.q}</span>
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-line bg-canvas text-text-muted transition group-open:rotate-45 group-open:border-brand-400 group-open:bg-brand-600 group-open:text-white">+</span>
                    </summary>
                    <p className="ml-8 mt-3 border-l-2 border-brand-600/15 pl-4 text-sm leading-relaxed text-text-muted">{f.a}</p>
                  </details>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ================= FINAL CTA ================= */}
        <section className="theme-dark relative overflow-hidden bg-[image:var(--grad-ink)] py-14 text-white">
          <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-40" />
          <div className="blob animate-float-slow left-[10%] top-[10%] h-72 w-72" style={{ background: "radial-gradient(circle, rgba(20,99,255,0.6), transparent 70%)" }} />
          <div className="blob animate-float right-[8%] bottom-[0%] h-72 w-72" style={{ background: "radial-gradient(circle, rgba(16,185,163,0.55), transparent 70%)" }} />
          <Reveal className="relative mx-auto max-w-3xl px-4 text-center">
            <h2 className="font-display text-3xl font-extrabold text-white md:text-5xl">Ofisinizde kaybolan fırsatları <span className="text-gradient">bugün</span> görün</h2>
            <p className="mx-auto mt-4 max-w-xl text-white/70">14 gün ücretsiz. Kredi kartı yok. Verileriniz size ait, istediğiniz an dışa aktarın.</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link href="/kayit" className="btn-shine inline-flex items-center gap-2 rounded-[12px] bg-white px-7 py-3.5 text-sm font-bold text-ink-950 transition hover:bg-white/90">Hemen başla <ArrowRight className="h-4 w-4" /></Link>
              <Link href="/demo" className="inline-flex items-center gap-2 rounded-[12px] border border-white/25 px-7 py-3.5 text-sm font-semibold text-white transition hover:bg-white/10">Canlı demo</Link>
            </div>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-white/60">
              <span className="flex items-center gap-2"><Lock className="h-4 w-4" /> KVKK & AB sunucu</span>
              <span className="flex items-center gap-2"><Scale className="h-4 w-4" /> İYS/EİDS uyumlu</span>
              <span className="flex items-center gap-2"><Check className="h-4 w-4" /> Taahhütsüz</span>
            </div>
          </Reveal>
        </section>
      </main>

      {/* ================= MEGA FOOTER ================= */}
      <footer className="footer-premium theme-dark border-t border-white/10 bg-[#041127]">
        <div className="mx-auto max-w-6xl px-4 py-12">
          <div className="mb-10 grid gap-4 border-b border-white/10 pb-8 sm:grid-cols-3">
            {[
              { icon: ShieldCheck, title: "KVKK uyumlu", text: "AB bölgesinde güvenli veri" },
              { icon: Scale, title: "İYS · EİDS hazır", text: "Mevzuat akışları ürün içinde" },
              { icon: Headphones, title: "Yerel uzman destek", text: "Türkiye operasyon ekibi" },
            ].map((item) => (
              <div key={item.title} className="flex items-center gap-3 rounded-[14px] border border-white/8 bg-white/[0.035] p-4">
                <span className="grid h-10 w-10 place-items-center rounded-[12px] bg-white/8 text-mint-400"><item.icon className="h-5 w-5" /></span>
                <div><p className="text-sm font-bold text-white">{item.title}</p><p className="text-xs text-white/45">{item.text}</p></div>
              </div>
            ))}
          </div>
          <div className="grid gap-10 lg:grid-cols-[1.6fr_1fr_1fr_1fr_1.2fr]">
            <div>
              <div className="flex items-center gap-2">
                <span className="grid h-9 w-9 place-items-center rounded-[11px] bg-[image:var(--grad-brand)] font-display text-base font-extrabold text-white">E</span>
                <span className="font-display text-lg font-extrabold text-white">EmlakSoft</span>
              </div>
              <p className="mt-4 max-w-xs text-sm text-text-muted">Türkiye için en kapsamlı emlak işletim sistemi. Müşteri, portföy, komisyon ve uyumluluk tek platformda.</p>
              <div className="mt-4 flex items-center gap-2 text-sm text-text-muted">
                <span className="status-pulse h-2 w-2 rounded-full bg-mint-500" /> Frankfurt (eu-central-1)
              </div>
            </div>

            {[
              { title: "Ürün", links: [["Özellikler", "#ozellikler"], ["Fiyatlandırma", "#fiyat"], ["Karşılaştırma", "#karsilastirma"], ["Canlı demo", "/demo"]] },
              { title: "Çözümler", links: [["Danışman", "#fiyat"], ["Ofis", "#fiyat"], ["Franchise", "#fiyat"], ["Proje satış", "#fiyat"]] },
              { title: "Şirket", links: [["Hakkımızda", "#ozellikler"], ["Ürün gündemi", "#nasil"], ["İletişim", "mailto:destek@emlaksoft.com.tr"], ["Kariyer", "mailto:destek@emlaksoft.com.tr"]] },
            ].map((col) => (
              <div key={col.title}>
                <h4 className="text-sm font-bold text-white">{col.title}</h4>
                <ul className="mt-4 space-y-2.5 text-sm">
                  {col.links.map(([label, href]) => (
                    <li key={label}><Link href={href} className="text-text-muted transition hover:text-brand-600">{label}</Link></li>
                  ))}
                </ul>
              </div>
            ))}

            <div>
              <h4 className="text-sm font-bold text-white">Ürün turuna katılın</h4>
              <p className="mt-4 text-sm text-text-muted">14 gün ücretsiz deneyin; kredi kartı gerekmez.</p>
              <Link href="/kayit" className="btn-shine mt-3 inline-flex items-center gap-2 rounded-[10px] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white">
                Ücretsiz başlayın <ArrowRight className="h-4 w-4" />
              </Link>
              <div className="mt-4 flex gap-2">
                {[MessageCircle, Send].map((Ic, i) => (
                  <span key={i} className="grid h-9 w-9 place-items-center rounded-[10px] border border-white/10 text-white/55"><Ic className="h-4 w-4" /></span>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-12 border-t border-line pt-6 text-sm text-text-muted">
            <div className="flex flex-wrap justify-center gap-x-5 gap-y-2 md:justify-start">
              <Link href="/kullanim-sartlari" className="hover:text-brand-600">Kullanım Şartları</Link>
              <Link href="/gizlilik" className="hover:text-brand-600">Gizlilik Politikası</Link>
              <Link href="/kvkk-aydinlatma" className="hover:text-brand-600">KVKK Aydınlatma</Link>
              <Link href="/cerez-politikasi" className="hover:text-brand-600">Çerez Politikası</Link>
              <Link href="/mesafeli-satis" className="hover:text-brand-600">Mesafeli Satış Sözleşmesi</Link>
              <Link href="/on-bilgilendirme" className="hover:text-brand-600">Ön Bilgilendirme</Link>
              <Link href="/iptal-iade" className="hover:text-brand-600">İptal &amp; İade</Link>
            </div>
            <p className="mt-4 text-center md:text-left">© {new Date().getFullYear()} EmlakSoft. Tüm hakları saklıdır.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
