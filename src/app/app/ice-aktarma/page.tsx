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
import { effectiveHasPermission } from "@/lib/permissions-effective";
import { createClient } from "@/lib/supabase/server";
import { daysAgoIso } from "@/lib/clock";
import { ImportWizard } from "./import-wizard";
import { IMPORT_ROW_LIMIT } from "./import-config";
import { listRecentImports } from "@/app/actions/import-rollback";

import { PageHeader } from "@/components/ui/page-header";
import { HelpTip } from "@/components/ui/help-tip";
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
  const { perms } = await requireModulePage("customers");
  const canImportProperties = effectiveHasPermission(perms, "properties", "create");
  const canImportDemands = effectiveHasPermission(perms, "demands", "create");
  const canImportActivity = {
    tasks: effectiveHasPermission(perms, "tasks", "create"),
    appointments: effectiveHasPermission(perms, "appointments", "create"),
    expenses: effectiveHasPermission(perms, "expenses", "create"),
  };
  const updateAllowed = {
    customers: effectiveHasPermission(perms, "customers", "edit"),
    properties: effectiveHasPermission(perms, "properties", "edit"),
    demands: false,
    tasks: false,
    appointments: false,
    expenses: false,
  };
  const rollbackAllowed = {
    customers: effectiveHasPermission(perms, "customers", "delete"),
    properties: effectiveHasPermission(perms, "properties", "delete"),
    demands: effectiveHasPermission(perms, "demands", "delete"),
    tasks: effectiveHasPermission(perms, "tasks", "delete"),
    appointments: effectiveHasPermission(perms, "appointments", "delete"),
    expenses: effectiveHasPermission(perms, "expenses", "delete"),
  };
  const supabase = await createClient();
  const since30 = daysAgoIso(30);

  const [
    { count: customerCount },
    { count: propertyCount },
    { count: newCustomers30 },
    { count: newProperties30 },
    { data: teamRows },
    recentImports,
  ] = await Promise.all([
    supabase.from("customers").select("id", { count: "exact", head: true }).is("deleted_at", null),
    supabase.from("properties").select("id", { count: "exact", head: true }).is("deleted_at", null),
    supabase
      .from("customers")
      .select("id", { count: "exact", head: true })
      .is("deleted_at", null)
      .gte("created_at", since30),
    supabase
      .from("properties")
      .select("id", { count: "exact", head: true })
      .is("deleted_at", null)
      .gte("created_at", since30),
    supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name").limit(200),
    listRecentImports(),
  ]);
  const team = (teamRows ?? []).map((m) => ({ id: m.id as string, name: String(m.full_name ?? "") }));
  const recent = recentImports.batches;

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
      title: "2 · Eşleyin ve önizleyin",
      desc: "Başlıklar Türkçe eşanlamlılarla tahmin edilir; mükerrer politikasını (atla / güncelle / yeni oluştur) siz seçersiniz.",
    },
    {
      icon: CheckCircle2,
      title: "3 · Sonucu görün",
      desc: "Önce yazmadan önizleme, sonra sonuç özeti; hatalı satırlar CSV olarak iner, tüm aktarma geri alınabilir.",
    },
  ];

  const guarantees = [
    {
      icon: ShieldCheck,
      title: "Mükerrer koruması",
      desc: "Telefon veya e-postası kayıtlı müşteriler varsayılan olarak atlanır; isterseniz mevcut kaydı güncelleyebilir ya da yeni kayıt açabilirsiniz.",
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
      desc: `Büyük dosyalar sunucuda parça parça işlenir. ${nf.format(IMPORT_ROW_LIMIT)} satırdan büyük listeleri bölerek art arda yükleyebilirsiniz.`,
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

      <PageHeader title="CSV içe aktarma" eyebrow="Veri taşıma" description={<>Eski programınızdan veya Excel&apos;den aldığınız müşteri, portföy ve talep listelerini EmlakSoft&apos;a taşıyın: dosya yükleyin, eşleyin, önizleyin, aktarın; gerekirse geri alın. <HelpTip topic="ice-aktarma" /></>} />
<section className="theme-dark relative overflow-hidden rounded-[var(--radius-panel)] bg-[image:var(--grad-ink)] p-6 text-white"><div className="relative"><p className="mt-3 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/70">
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
                  className="focus-ring press group relative block rounded-[var(--radius-card)] border border-white/10 bg-white/5 p-3.5 transition hover:border-white/30"
                >
                  <ArrowUpRight className="hover-action absolute right-2.5 top-2.5 h-3.5 w-3.5 text-white/50 opacity-0 transition group-hover:opacity-100" />
                  <span className="flex items-center gap-1.5 text-xs text-white/50">
                    <Icon className="h-3.5 w-3.5" /> {k.label}
                  </span>
                  <p className={`numeric mt-1.5 font-display text-xl font-extrabold tabular-nums ${k.accent}`}>
                    {nf.format(k.value)}
                  </p>
                </Link>
              );
            })}
          </div></div></section>

      {/* Nasıl çalışır — 3 adım */}
      <section className="grid gap-3 md:grid-cols-3">
        {steps.map((s) => {
          const Icon = s.icon;
          return (
            <div
              key={s.title}
              className="lift rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]"
            >
              <span className="grid h-10 w-10 place-items-center rounded-[var(--radius-card)] bg-brand-600/10 text-brand-600">
                <Icon className="h-5 w-5" />
              </span>
              <p className="mt-3 font-display text-sm font-bold text-ink-950">{s.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-text-muted">{s.desc}</p>
            </div>
          );
        })}
      </section>

      <ImportWizard
        canImportProperties={canImportProperties}
        canImportDemands={canImportDemands}
        canImportActivity={canImportActivity}
        updateAllowed={updateAllowed}
        rollbackAllowed={rollbackAllowed}
        team={team}
        recent={recent}
      />

      {/* Güvence kartları — aktarımın teknik garantileri */}
      <section className="grid gap-3 md:grid-cols-3">
        {guarantees.map((g) => {
          const Icon = g.icon;
          return (
            <div key={g.title} className="rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)]">
              <div className="flex items-start gap-3">
                <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-control)] ${g.tone}`}>
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
