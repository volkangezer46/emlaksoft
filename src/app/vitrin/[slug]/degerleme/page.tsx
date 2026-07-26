import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Calculator, Clock3, ShieldCheck, Sparkles } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { ValuationFunnel } from "@/components/public/valuation-funnel";

// ISR: vitrin gibi herkese açık — CDN önbellekli, 2 dk tazelenir.
// SEO mıknatısı: bilerek indexlenebilir (noindex YOK).
export const revalidate = 120;

const FALLBACK_PROPERTY_TYPES = ["Daire", "Villa", "Müstakil ev", "İşyeri", "Arsa"];

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const admin = createAdminClient();
  const { data: tenant } = await admin
    .from("tenants")
    .select("id, name")
    .eq("slug", slug)
    .maybeSingle();
  if (!tenant) return { title: "Vitrin bulunamadı" };

  const title = `${tenant.name} | Ücretsiz Değerleme`;
  const description = `Eviniz ne kadar eder? ${tenant.name} ile il, ilçe ve m² bilgisinden ücretsiz ön değerleme alın; net değerleme için danışman sizi arasın.`;

  return {
    title: { absolute: title },
    description,
    alternates: { canonical: `/vitrin/${slug}/degerleme` },
    openGraph: {
      type: "website",
      locale: "tr_TR",
      siteName: tenant.name ?? "EmlakSoft",
      title,
      description,
      url: `/vitrin/${slug}/degerleme`,
    },
    twitter: { card: "summary", title, description },
  };
}

export default async function VitrinDegerlemePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const admin = createAdminClient();

  const { data: tenant } = await admin
    .from("tenants")
    .select("id, name, brand_color, lead_capture_token, lead_capture_enabled")
    .eq("slug", slug)
    .maybeSingle();

  if (!tenant) notFound();

  // provinces + mülk tipi tanımları tenant'tan bağımsız değil ama paralel çekilebilir.
  // Tanımlar: global (tenant_id null) + ofise özel; aynı value'da ofis kazanır
  // (getDefinitions ile aynı mantık — o, oturumlu istemci kullandığı için burada
  // admin istemciyle yeniden kurulur).
  const [{ data: provinces }, { data: defs }] = await Promise.all([
    admin.from("geo_provinces").select("id, name").eq("is_active", true).order("name"),
    admin
      .from("definitions")
      .select("value, tenant_id, sort_order")
      .eq("category", "property_type")
      .eq("is_active", true)
      .or(`tenant_id.is.null,tenant_id.eq.${tenant.id}`)
      .order("sort_order", { ascending: true }),
  ]);

  const seen = new Set<string>();
  const propertyTypes: string[] = [];
  for (const d of defs ?? []) {
    if (!seen.has(d.value)) {
      seen.add(d.value);
      propertyTypes.push(d.value);
    }
  }
  const typeOptions = propertyTypes.length ? propertyTypes : FALLBACK_PROPERTY_TYPES;
  const leadEnabled = tenant.lead_capture_enabled !== false && Boolean(tenant.lead_capture_token);

  return (
    <div className="min-h-screen bg-canvas">
      <div className="theme-dark relative overflow-hidden bg-[image:var(--grad-ink)] text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
        <div className="pointer-events-none absolute -right-20 -top-24 h-80 w-80 rounded-full bg-brand-600/25 blur-[120px]" />

        <div className="relative mx-auto max-w-6xl px-4 py-12 sm:py-16">
          <Link
            href={`/vitrin/${slug}`}
            className="focus-ring flex w-fit items-center gap-3 rounded-[14px] transition hover:opacity-90"
          >
            <span
              className="grid h-11 w-11 place-items-center rounded-[13px] text-base font-extrabold text-white"
              style={{ background: tenant.brand_color || "var(--grad-brand)" }}
            >
              {tenant.name ? tenant.name[0] : "E"}
            </span>
            <span>
              <span className="block font-display text-lg font-extrabold">{tenant.name}</span>
              <span className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-mint-400">
                Ücretsiz değerleme
              </span>
            </span>
          </Link>

          <div className="mt-8 grid gap-10 lg:grid-cols-[1.1fr_1fr]">
            <div>
              <h1 className="max-w-xl font-display text-3xl font-extrabold leading-tight sm:text-4xl">
                Evim ne kadar eder?
              </h1>
              <p className="mt-3 max-w-lg text-sm leading-relaxed text-white/60">
                İl, ilçe ve metrekare bilgisini girin; {tenant.name} bölge verisiyle mülkünüz için
                tahmini bir değer aralığı üretelim. Sonrasında dilerseniz danışmanımız net değerleme
                için sizi arasın — tamamen ücretsiz.
              </p>
              <ul className="mt-6 space-y-3 text-sm text-white/70">
                <li className="flex items-start gap-2.5">
                  <Calculator className="mt-0.5 h-4 w-4 shrink-0 text-mint-400" />
                  Bölgedeki gerçekleşen satışlar ve güncel portföy verisine dayalı tahmin
                </li>
                <li className="flex items-start gap-2.5">
                  <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-mint-400" />
                  30 saniyede sonuç — üyelik ya da ödeme yok
                </li>
                <li className="flex items-start gap-2.5">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-mint-400" />
                  Verileriniz yalnızca değerleme ve iletişim için kullanılır
                </li>
              </ul>
              <p className="mt-6 flex items-start gap-2 rounded-[12px] border border-white/10 bg-white/5 px-3.5 py-3 text-[11px] leading-relaxed text-white/50">
                <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-mint-400" />
                Bu araç bir ön tahmin sunar; resmi/ekspertiz değerleme raporu yerine geçmez. Net değer,
                mülkün yerinde incelenmesiyle belirlenir.
              </p>
            </div>

            <div className="rounded-[20px] border border-white/10 bg-[#071a38] p-6 shadow-[var(--shadow-xs)] sm:p-7">
              <ValuationFunnel
                slug={slug}
                provinces={provinces ?? []}
                propertyTypes={typeOptions}
                leadEnabled={leadEnabled}
              />
            </div>
          </div>

          <Link
            href={`/vitrin/${slug}`}
            className="mt-10 inline-flex items-center gap-1.5 text-xs font-semibold text-white/50 underline-offset-2 transition hover:text-white hover:underline"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> {tenant.name} vitrinine dön
          </Link>
        </div>
      </div>

      <footer className="border-t border-line py-6 text-center text-[11px] text-text-faint">
        <Link href="/" className="font-semibold underline-offset-2 transition hover:text-brand-600 hover:underline">
          Powered by EmlakSoft
        </Link>{" "}
        — Türkiye&apos;nin emlak işletim sistemi
      </footer>
    </div>
  );
}
