import Link from "next/link";
import { LineChart, ShieldAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { now } from "@/lib/clock";
import { fetchLatestRates, fxAgeLabel } from "@/lib/fx";
import {
  DEFAULT_LOAN_MONTHS,
  DEFAULT_MONTHLY_RATE_PCT,
  MAX_LOAN_MONTHS,
  MIN_LOAN_MONTHS,
} from "@/lib/purchase-costs";
import {
  DEFAULT_GROWTH_SOURCE_MONTH,
  INVESTMENT_DEFAULTS,
  estimateMonthlyRent,
} from "@/lib/investment";
import { InvestmentAnalyzer, type InvestmentProperty } from "./investment-analyzer";

export const metadata = { title: "Yatırım getirisi analizi" };

/** features.sqm — string ("120" / "120,5") ya da number gelebilir. */
function sqmOf(features: unknown): number | null {
  const raw = (features as { sqm?: number | string | null } | null)?.sqm;
  const n = typeof raw === "string" ? Number(raw.replace(",", ".")) : Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/** Medyan — tek/çift eleman ayrımıyla. Boş dizide null. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

/** URL paramı → sayı. Geçersizse `fallback`. */
function num(raw: string | undefined, fallback: number): number {
  if (raw == null || raw === "") return fallback;
  const n = Number(String(raw).replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

const SALE = "Satılık";
const RENT = "Kiralık";

/**
 * Yatırımcı paketi — kira getirisi, nakit akışı ve 10 yıllık projeksiyon.
 *
 * MODÜL KAPISI: `valuation`. Yeni modül anahtarı AÇILMADI — /app/hesaplayici
 * ve /app/kira-artis gibi bu ekran da değerleme/analiz ailesinin parçasıdır.
 *
 * SEARCHPARAMS SÖZLEŞMESİ: tüm girdiler URL'de taşınır (`?fiyat=&kira=&
 * pesinat=&vade=&faiz=&bosluk=&bakim=&yonetim=&vergi=&artis=&deger=`), böylece
 * danışman "Müşteriye gönder" ile linki yollayınca müşteri BİREBİR aynı
 * sonucu görür. Hesabın tamamı saf fonksiyonlarda ve istemcide çalışır;
 * sunucu yalnız portföy listesi ve kira önerisi için sorgu atar.
 */
export default async function InvestmentPage({
  searchParams,
}: {
  searchParams: Promise<{
    portfoy?: string;
    fiyat?: string;
    kira?: string;
    pesinat?: string;
    vade?: string;
    faiz?: string;
    bosluk?: string;
    bakim?: string;
    yonetim?: string;
    vergi?: string;
    artis?: string;
    deger?: string;
    m2?: string;
  }>;
}) {
  await requireModulePage("valuation");
  const sp = await searchParams;
  const supabase = await createClient();

  // Fiyatlı satılık portföyler — hesap satış bedeli üzerinden kurulduğu için
  // fiyatsız kayıt seçicide anlamsız.
  const [{ data: saleRows }, { data: rentRows }, fxRates] = await Promise.all([
    supabase
      .from("properties")
      .select("id, property_code, title, list_price, transaction_type, features, district_id")
      .is("deleted_at", null)
      .eq("transaction_type", SALE)
      .gt("list_price", 0)
      .order("created_at", { ascending: false })
      .limit(150),
    // Bölge kira önerisi: kiralık ilanlardan ilçe bazında medyan ₺/m².
    supabase
      .from("properties")
      .select("list_price, features, district_id")
      .is("deleted_at", null)
      .eq("transaction_type", RENT)
      .gt("list_price", 0)
      .limit(1000),
    fetchLatestRates(supabase),
  ]);

  // İlçe → medyan aylık kira (₺/m²). Alan bilgisi olmayan ilan hesaba girmez.
  const rentByDistrict = new Map<string, number[]>();
  for (const r of rentRows ?? []) {
    const s = sqmOf(r.features);
    const p = r.list_price != null ? Number(r.list_price) : null;
    if (!s || !p || !r.district_id) continue;
    const list = rentByDistrict.get(r.district_id) ?? [];
    list.push(p / s);
    rentByDistrict.set(r.district_id, list);
  }
  const rentPerSqmOf = (districtId: string | null): number | null => {
    if (!districtId) return null;
    const list = rentByDistrict.get(districtId);
    // Tek ilandan medyan çıkarmak yanıltıcı — en az 3 örnek istiyoruz.
    if (!list || list.length < 3) return null;
    return median(list);
  };

  const toProperty = (p: {
    id: string;
    property_code: string;
    title: string | null;
    list_price: number | string | null;
    features: unknown;
    district_id: string | null;
  }): InvestmentProperty => {
    const sqm = sqmOf(p.features);
    const ppm2 = rentPerSqmOf(p.district_id);
    return {
      id: p.id,
      label: p.title || p.property_code,
      code: p.property_code,
      price: p.list_price != null ? Number(p.list_price) : null,
      sqm,
      // Bölge medyanı × m² → "bu daire kaça kiraya çıkar" önerisi.
      suggestedRent: ppm2 && sqm ? Math.round(ppm2 * sqm) : null,
      suggestedRentSample: ppm2 && sqm ? (rentByDistrict.get(p.district_id ?? "")?.length ?? 0) : 0,
      actualRent: null,
    };
  };

  const properties: InvestmentProperty[] = (saleRows ?? []).map(toProperty);

  // `?portfoy=` listede yoksa (150 kayıt sınırı dışında) tek tek çekilir —
  // portföy detayından gelen link her zaman çalışsın.
  let selected = properties.find((p) => p.id === sp.portfoy) ?? null;
  if (sp.portfoy && !selected) {
    const { data: one } = await supabase
      .from("properties")
      .select("id, property_code, title, list_price, transaction_type, features, district_id")
      .eq("id", sp.portfoy)
      .is("deleted_at", null)
      .maybeSingle();
    if (one) {
      selected = toProperty(one);
      properties.unshift(selected);
    }
  }

  // GERÇEK KİRA: portföyün yürürlükteki kira sözleşmesi varsa tahmin yerine o
  // kullanılır — elimizde ölçülmüş veri varken medyan tahmini yapmak saçma.
  if (selected) {
    const { data: rental } = await supabase
      .from("rentals")
      .select("monthly_rent")
      .eq("property_id", selected.id)
      .eq("status", "active")
      .order("start_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (rental?.monthly_rent != null) selected.actualRent = Number(rental.monthly_rent);
  }

  // Öncelik: URL'deki açık değer > seçili portföyün verisi > varsayılan.
  const price = num(sp.fiyat, selected?.price ?? 0);
  const sqm = num(sp.m2, selected?.sqm ?? 0);
  const fallbackRent =
    selected?.actualRent ?? selected?.suggestedRent ?? (price > 0 ? estimateMonthlyRent(price) : 0);
  const monthlyRent = num(sp.kira, fallbackRent);
  const downPayment =
    sp.pesinat != null && sp.pesinat !== ""
      ? num(sp.pesinat, 0)
      : price > 0
        ? Math.round(price * 0.25)
        : 0;
  const months = Math.min(
    MAX_LOAN_MONTHS,
    Math.max(MIN_LOAN_MONTHS, Math.round(num(sp.vade, DEFAULT_LOAN_MONTHS))),
  );

  return (
    <div className="space-y-6">
      <section className="theme-dark no-print relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-14 -top-16 h-56 w-56 rounded-full bg-mint-400/20 blur-[80px]" />
        <div className="relative">
          <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-mint-400">
            <LineChart className="h-3.5 w-3.5" /> Yatırımcı sorusu: &quot;kaç yılda kendini amorti eder?&quot;
          </p>
          <h1 className="mt-2 font-display text-3xl font-extrabold">Yatırım getirisi analizi</h1>
          <p className="mt-2 max-w-2xl text-sm text-white/60">
            Kira getirisi, aylık nakit akışı ve {INVESTMENT_DEFAULTS.projectionYears} yıllık projeksiyon tek ekranda.
            Amorti süresini, aylık cebe kalanı ve kredi bittikten sonraki sıçramayı yıl yıl gösterir — sonucu tek tıkla
            müşteriye link olarak gönderin.
          </p>
          <p className="mt-4 inline-flex items-start gap-2 rounded-[12px] border border-white/15 bg-white/5 px-3 py-2 text-xs text-white/70">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-mint-400" />
            Kira ve değer artışı varsayılanı, TÜFE 12 aylık ortalamasının en güncel ayından ({DEFAULT_GROWTH_SOURCE_MONTH})
            gelir — kira yenileme radarıyla aynı kaynak. Çıktı her hâlükârda{" "}
            <strong className="text-white">yaklaşıktır</strong>.
          </p>
          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            <Link
              href="/app/hesaplayici"
              className="focus-ring press rounded-[10px] border border-white/15 bg-white/5 px-3 py-2 font-semibold text-white/80 transition hover:border-white/35"
            >
              Alım maliyeti hesaplayıcı →
            </Link>
            <Link
              href="/app/kira-artis"
              className="focus-ring press rounded-[10px] border border-white/15 bg-white/5 px-3 py-2 font-semibold text-white/80 transition hover:border-white/35"
            >
              Kira artış hesaplayıcı →
            </Link>
            <Link
              href="/app/bolge-analizi"
              className="focus-ring press rounded-[10px] border border-white/15 bg-white/5 px-3 py-2 font-semibold text-white/80 transition hover:border-white/35"
            >
              Bölge analizi →
            </Link>
          </div>
        </div>
      </section>

      <InvestmentAnalyzer
        properties={properties}
        fx={
          fxRates
            ? { usd: fxRates.usd, eur: fxRates.eur, ageLabel: fxAgeLabel(fxRates.rateDate, now()) }
            : null
        }
        initial={{
          propertyId: selected?.id ?? "",
          price,
          sqm,
          monthlyRent,
          rentSource: sp.kira
            ? "manual"
            : selected?.actualRent != null
              ? "contract"
              : selected?.suggestedRent != null
                ? "region"
                : price > 0
                  ? "estimate"
                  : "manual",
          downPayment,
          months,
          monthlyRatePct: num(sp.faiz, DEFAULT_MONTHLY_RATE_PCT),
          vacancyPct: num(sp.bosluk, INVESTMENT_DEFAULTS.vacancyPct),
          maintenancePct: num(sp.bakim, INVESTMENT_DEFAULTS.maintenancePct),
          managementPct: num(sp.yonetim, INVESTMENT_DEFAULTS.managementPct),
          taxPct: num(sp.vergi, INVESTMENT_DEFAULTS.taxPct),
          rentGrowthPct: num(sp.artis, INVESTMENT_DEFAULTS.rentGrowthPct),
          priceGrowthPct: num(sp.deger, INVESTMENT_DEFAULTS.priceGrowthPct),
        }}
      />
    </div>
  );
}
