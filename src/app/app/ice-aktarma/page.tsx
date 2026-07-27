import Link from "next/link";
import {
  ArrowLeft,
  ArrowUpRight,
  Building2,
  CheckCircle2,
  Columns3,
  FileSpreadsheet,
  Languages,
  ShieldCheck,
  Table2,
  UploadCloud,
  Users,
} from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { createClient } from "@/lib/supabase/server";
import { daysAgoIso } from "@/lib/clock";
import { ImportWizard } from "./import-wizard";
import { IMPORT_ROW_LIMIT } from "./import-config";

export const metadata = { title: "İçe aktarma" };

const nf = new Intl.NumberFormat("tr-TR");

/**
 * CSV içe aktarma sihirbazı — başka programdan/Excel'den taşınan müşteri ve
 * portföy listelerini üç adımda içeri alır. Sayfa kapısı "customers" modülü;
 * portföy aktarımı ayrıca server action'da "properties.create" ile korunur.
 *
 * KPI şeridi gerçek veriden beslenir: mevcut müşteri/portföy sayıları ve son
 * 30 günde eklenen kayıtlar (RLS tenant'ı süzer). Kartlar ilgili modüle gider;
 * hedef sayfalar bu ekranın alanı dışında olduğundan parametresiz link verilir.
 */
export default async function ImportPage() {
  await requireModulePage("customers");
  const supabase = await createClient();
  const since30 = daysAgoIso(30);

  const [
    { count: customerCount },
    { count: propertyCount },
    { count: newCustomers30 },
    { count: newProperties30 },
  ] = await Promise.all([
    supabase.from("customers").select("id", { count: "exact", head: true }).is("deleted_at", null),
    supabase.from("properties").select("id", { count: "exact", head: true }),
    supabase
      .from("customers")
      .select("id", { count: "exact", head: true })
      .is("deleted_at", null)
      .gte("created_at", since30),
    supabase.from("properties").select("id", { count: "exact", head: true }).gte("created_at", since30),
  ]);

  const kpis = [
    {
      label: "Kayıtlı müşteri",
      value: customerCount ?? 0,
      icon: Users,
      href: "/app/musteriler",
      accent: "text-white",
    },
    {
      label: "Kayıtlı portföy",
      value: propertyCount ?? 0,
      icon: Building2,
      href: "/app/portfoyler",
      accent: "text-white",
    },
    {
      label: "Son 30 günde müşteri",
      value: newCustomers30 ?? 0,
      icon: Users,
      href: "/app/musteriler",
      accent: "text-mint-400",
    },
    {
      label: "Son 30 günde portföy",
      value: newProperties30 ?? 0,
      icon: Building2,
      href: "/app/portfoyler",
      accent: "text-cyan-400",
    },
  ];

  const steps = [
    {
      icon: UploadCloud,
      title: "1 · Dosyayı yükleyin",
      desc: "CSV dosyanızı sürükleyip bırakın. Ayraç (virgül / noktalı virgül) otomatik algılanır.",
    },
    {
      icon: Columns3,
      title: "2 · Kolonları eşleyin",
      desc: "Başlıklar Türkçe ipuçlarıyla otomatik tahmin edilir; dilerseniz elle düzeltirsiniz.",
    },
    {
      icon: CheckCircle2,
      title: "3 · Sonucu görün",
      desc: "Eklenen, atlanan ve hatalı satırlar tek ekranda raporlanır — sürpriz yok.",
    },
  ];

  const guarantees = [
    {
      icon: ShieldCheck,
      title: "Mükerrer koruması",
      desc: "Telefonu zaten kayıtlı müşteriler otomatik atlanır; aynı listeyi iki kez yükleseniz bile kopya oluşmaz.",
      tone: "bg-mint-500/12 text-mint-600",
    },
    {
      icon: Languages,
      title: "Türkçe Excel uyumu",
      desc: "Windows-1254 (Türkçe ANSI) kodlu eski Excel çıktıları ve noktalı virgül ayraçlı dosyalar sorunsuz çözülür.",
      tone: "bg-brand-600/10 text-brand-600",
    },
    {
      icon: Table2,
      title: `Tek seferde ${nf.format(IMPORT_ROW_LIMIT)} satır`,
      desc: `Her yüklemede ${nf.format(IMPORT_ROW_LIMIT)} satıra kadar işlenir. Daha büyük listeleri parçalara bölerek art arda yükleyebilirsiniz.`,
      tone: "bg-amber-400/15 text-amber-600",
    },
  ];

  return (
    <div className="space-y-6">
      <Link
        href="/app/ayarlar"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted transition hover:text-brand-600"
      >
        <ArrowLeft className="h-4 w-4" /> Ayarlara dön
      </Link>

      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-5 text-white md:p-6">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-14 -top-16 h-60 w-60 rounded-full bg-brand-600/35 blur-[80px]" />
        <div className="pointer-events-none absolute -left-20 bottom-0 h-44 w-44 rounded-full bg-mint-500/20 blur-[80px]" />
        <div className="relative">
          <span className="flex items-center gap-2 text-xs font-semibold text-mint-400">
            <UploadCloud className="h-4 w-4" /> Veri taşıma
          </span>
          <h1 className="mt-2 font-display text-2xl font-extrabold md:text-3xl">CSV içe aktarma</h1>
          <p className="mt-1 max-w-2xl text-sm text-white/60">
            Eski programınızdan veya Excel&apos;den aldığınız müşteri ve portföy listelerini üç
            adımda EmlakSoft&apos;a taşıyın: dosya yükleyin, kolonları eşleyin, sonucu görün.
          </p>
          <p className="mt-3 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-white/70">
            <FileSpreadsheet className="h-3.5 w-3.5 text-mint-400" />
            Excel dosyanızı &quot;Farklı Kaydet → CSV&quot; ile kaydedin — .xlsx doğrudan desteklenmez.
          </p>

          {/* KPI şeridi — mevcut veri hacmi; kartlar ilgili modül listesine gider */}
          <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {kpis.map((k) => {
              const Icon = k.icon;
              return (
                <Link
                  key={k.label}
                  href={k.href}
                  className="focus-ring press group relative block rounded-[14px] border border-white/10 bg-white/5 p-3.5 transition hover:border-white/30"
                >
                  <ArrowUpRight className="hover-action absolute right-2.5 top-2.5 h-3.5 w-3.5 text-white/50 opacity-0 transition group-hover:opacity-100" />
                  <span className="flex items-center gap-1.5 text-[11px] text-white/50">
                    <Icon className="h-3.5 w-3.5" /> {k.label}
                  </span>
                  <p className={`numeric mt-1.5 font-display text-xl font-extrabold tabular-nums ${k.accent}`}>
                    {nf.format(k.value)}
                  </p>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      {/* Nasıl çalışır — 3 adım */}
      <section className="grid gap-3 md:grid-cols-3">
        {steps.map((s) => {
          const Icon = s.icon;
          return (
            <div
              key={s.title}
              className="lift rounded-[18px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]"
            >
              <span className="grid h-10 w-10 place-items-center rounded-[12px] bg-brand-600/10 text-brand-600">
                <Icon className="h-5 w-5" />
              </span>
              <p className="mt-3 font-display text-sm font-bold text-ink-950">{s.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-text-muted">{s.desc}</p>
            </div>
          );
        })}
      </section>

      <ImportWizard />

      {/* Güvence kartları — aktarımın teknik garantileri */}
      <section className="grid gap-3 md:grid-cols-3">
        {guarantees.map((g) => {
          const Icon = g.icon;
          return (
            <div key={g.title} className="rounded-[16px] border border-line bg-surface p-4 shadow-[var(--shadow-xs)]">
              <div className="flex items-start gap-3">
                <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-[11px] ${g.tone}`}>
                  <Icon className="h-4.5 w-4.5" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-ink-950">{g.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-text-muted">{g.desc}</p>
                </div>
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}
