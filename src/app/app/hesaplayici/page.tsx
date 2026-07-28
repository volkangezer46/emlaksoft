import Link from "next/link";
import { Calculator, ShieldAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import {
  DEFAULT_DOWN_PAYMENT_PCT,
  DEFAULT_LOAN_MONTHS,
  DEFAULT_MONTHLY_RATE_PCT,
  DEFAULT_RATES,
  MAX_LOAN_MONTHS,
  MIN_LOAN_MONTHS,
  type DeedFeeShare,
} from "@/lib/purchase-costs";
import { PurchaseCalculator, type CalculatorProperty } from "./calculator";

export const metadata = { title: "Alım maliyeti hesaplayıcı" };

/** features.sqm — string ("120" / "120,5") ya da number gelebilir. */
function sqmOf(features: unknown): number | null {
  const raw = (features as { sqm?: number | string | null } | null)?.sqm;
  const n = typeof raw === "string" ? Number(raw.replace(",", ".")) : Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/** URL paramı → sayı. Geçersizse `fallback`. */
function num(raw: string | undefined, fallback: number): number {
  if (raw == null || raw === "") return fallback;
  const n = Number(String(raw).replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * Alım maliyeti & kredi hesaplayıcısı.
 *
 * MODÜL KAPISI: `valuation` — projede değerleme/analiz ekranlarının anahtarı
 * budur (bkz. /app/degerleme). Yeni modül anahtarı AÇILMADI; hesaplayıcı
 * değerleme ailesinin bir parçası olarak aynı kapıdan geçer.
 *
 * SEARCHPARAMS: Sayfa tamamen link'lenebilir — "Müşteriye gönder" düğmesi
 * hesap parametrelerini URL'e yazar, link açıldığında aynı sonuç görünür.
 * Bu yüzden tüm parametreler burada okunup istemciye ilk değer olarak geçer.
 */
export default async function CalculatorPage({
  searchParams,
}: {
  searchParams: Promise<{
    portfoy?: string;
    fiyat?: string;
    pesinat?: string;
    vade?: string;
    faiz?: string;
    komisyon?: string;
    harc?: string;
    m2?: string;
    sekme?: string;
  }>;
}) {
  await requireModulePage("valuation");
  const sp = await searchParams;
  const supabase = await createClient();

  // Portföy listesi: fiyatı girilmiş satılık portföyler (hesap satış bedeli
  // üzerinden kurulduğu için fiyatsız kayıt seçici de anlamsız).
  const { data: propertyRows } = await supabase
    .from("properties")
    .select("id, property_code, title, list_price, transaction_type, features")
    .is("deleted_at", null)
    .gt("list_price", 0)
    .order("created_at", { ascending: false })
    .limit(150);

  const properties: CalculatorProperty[] = (propertyRows ?? []).map((p) => ({
    id: p.id,
    label: p.title || p.property_code,
    code: p.property_code,
    price: p.list_price != null ? Number(p.list_price) : null,
    sqm: sqmOf(p.features),
    transactionType: p.transaction_type ?? null,
  }));

  // `?portfoy=` listede yoksa (150 kayıt sınırının dışında) tek tek çekilir —
  // portföy detayından gelen link her zaman çalışsın.
  let selected = properties.find((p) => p.id === sp.portfoy) ?? null;
  if (sp.portfoy && !selected) {
    const { data: one } = await supabase
      .from("properties")
      .select("id, property_code, title, list_price, transaction_type, features")
      .eq("id", sp.portfoy)
      .is("deleted_at", null)
      .maybeSingle();
    if (one) {
      selected = {
        id: one.id,
        label: one.title || one.property_code,
        code: one.property_code,
        price: one.list_price != null ? Number(one.list_price) : null,
        sqm: sqmOf(one.features),
        transactionType: one.transaction_type ?? null,
      };
      properties.unshift(selected);
    }
  }

  // Öncelik: URL'deki açık değer > seçili portföyün değeri > varsayılan.
  const price = num(sp.fiyat, selected?.price ?? 0);
  const sqm = num(sp.m2, selected?.sqm ?? 0);
  const downPayment =
    sp.pesinat != null && sp.pesinat !== ""
      ? num(sp.pesinat, 0)
      : price > 0
        ? Math.round((price * DEFAULT_DOWN_PAYMENT_PCT) / 100)
        : 0;
  const months = Math.min(
    MAX_LOAN_MONTHS,
    Math.max(MIN_LOAN_MONTHS, Math.round(num(sp.vade, DEFAULT_LOAN_MONTHS))),
  );
  const deedFeeShare: DeedFeeShare = sp.harc === "buyer" ? "buyer" : "half";

  return (
    <div className="space-y-6">
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-14 -top-16 h-56 w-56 rounded-full bg-cyan-400/20 blur-[80px]" />
        <div className="relative">
          <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-cyan-400">
            <Calculator className="h-3.5 w-3.5" /> Müşteri sorusu: &quot;cebimden ne çıkar?&quot;
          </p>
          <h1 className="mt-2 font-display text-3xl font-extrabold">Alım maliyeti &amp; kredi hesaplayıcı</h1>
          <p className="mt-2 max-w-2xl text-sm text-white/60">
            Tapu harcı, döner sermaye, komisyon, sigorta ve kredi masraflarını kalem kalem çıkarır; peşinat + masraf
            toplamını ve aylık taksidi tek ekranda gösterir. Sonucu tek tıkla müşteriye link olarak gönderin.
          </p>
          <p className="mt-4 inline-flex items-start gap-2 rounded-[12px] border border-white/15 bg-white/5 px-3 py-2 text-xs text-white/70">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-cyan-400" />
            Oranlar mevzuata göre sabitlenmiştir ({DEFAULT_RATES.deedFeeTotalPct}% tapu harcı, %
            {DEFAULT_RATES.loanAllocationFeePct} kredi tahsis tavanı). Mevzuat değişirse tek dosyadan güncellenir —
            çıktı her hâlükârda <strong className="text-white">yaklaşıktır</strong>.
          </p>
          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            <Link
              href="/app/degerleme"
              className="focus-ring press rounded-[10px] border border-white/15 bg-white/5 px-3 py-2 font-semibold text-white/80 transition hover:border-white/35"
            >
              Değerleme motoru →
            </Link>
            <Link
              href="/app/yatirim"
              className="focus-ring press rounded-[10px] border border-white/15 bg-white/5 px-3 py-2 font-semibold text-white/80 transition hover:border-white/35"
            >
              Yatırım analizi →
            </Link>
            <Link
              href="/app/portfoyler"
              className="focus-ring press rounded-[10px] border border-white/15 bg-white/5 px-3 py-2 font-semibold text-white/80 transition hover:border-white/35"
            >
              Portföyler →
            </Link>
          </div>
        </div>
      </section>

      <PurchaseCalculator
        properties={properties}
        initial={{
          propertyId: selected?.id ?? "",
          price,
          downPayment,
          months,
          monthlyRatePct: num(sp.faiz, DEFAULT_MONTHLY_RATE_PCT),
          commissionPct: num(sp.komisyon, DEFAULT_RATES.commissionPct),
          deedFeeShare,
          sqm,
          tab: sp.sekme === "kredi" ? "kredi" : "maliyet",
        }}
      />
    </div>
  );
}
