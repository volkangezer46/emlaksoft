import type { Metadata } from "next";
import Link from "@/components/ui/smart-link";
import { requirePlatformModule } from "@/lib/platform";
import { pricingCopy } from "@/lib/pricing-page/copy";
import { copyContextOf, loadPricingViewData } from "@/lib/pricing-page/data";
import { defaultPricingPage } from "@/lib/pricing-page/defaults";
import { pricingPageStore } from "@/lib/pricing-page/store";
import { PricingPageView } from "@/lib/pricing-page/view";

export const metadata: Metadata = { title: "Fiyatlar önizlemesi", robots: { index: false, follow: false } };

/**
 * Personel önizlemesi: kayıtlı taslağı GERÇEK /fiyatlar düzeninde (aynı görünüm bileşeni, canlı paket verisi) çizer.
 * Yalnız oturumlu personel (`sitecontent`); noindex; JSON-LD basılmaz. Taslak yoksa yayındaki/varsayılan metin.
 */
export default async function AdminPricingPreview() {
  await requirePlatformModule("sitecontent");
  const [data, state] = await Promise.all([loadPricingViewData(), pricingPageStore.readState()]);
  const content = state.draft ?? state.live;
  const copy = pricingCopy(content ?? defaultPricingPage(), copyContextOf(data), { faqFromCode: !content });

  return (
    <div className="space-y-4">
      <p role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-panel)] border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <span>
          <b>Önizleme</b> · /fiyatlar · kayıtlı taslak gösteriliyor (kaydedilmemiş değişiklikler görünmez). Bu sayfa arama motorlarına kapalıdır.
        </span>
        <Link href="/admin/site/sayfalar/fiyatlar" className="inline-flex min-h-11 items-center font-semibold underline">Editöre dön</Link>
      </p>
      <div className="overflow-hidden rounded-[var(--radius-panel)] border border-line">
        <PricingPageView data={data} copy={copy} jsonLd={false} />
      </div>
    </div>
  );
}
