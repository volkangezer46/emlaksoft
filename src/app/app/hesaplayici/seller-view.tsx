import { PageHeader } from "@/components/ui/page-header";
import type { CalculatorSearchParams } from "./calculator-view";
import { getEffectiveLegalValues } from "@/lib/legal-constants/store";
import { SellerCalculator } from "./seller-calculator";

/** URL paramı → tam sayı (≥0). Geçersizse 0. */
function whole(raw: string | undefined): number {
  if (!raw) return 0;
  const n = Math.floor(Number(String(raw).replace(",", ".")));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Satıcı net/vergi hesaplayıcı sekmesi. Kapı (`valuation`) çağıran sayfadadır; başlangıç değerleri
 * `?satis=&alis=&ay=` ile link'lenebilir. Mevzuat sabitleri o gün yürürlükteki değerdir (AD12 tarihli geçmiş,
 * önbellekli okuma; okunamazsa koddaki değer) ve istemci hesaplayıcıya prop olarak geçer.
 */
export async function SellerView({ sp }: { sp: CalculatorSearchParams }) {
  const legal = await getEffectiveLegalValues();
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={'Satıcı sorusu: "elime ne geçer?"'}
        title="Satıcı net / vergi hesaplayıcı"
        description="Satış bedeli, alış bedeli ve elde tutma süresinden tapu harcı, komisyon, değer artış kazancı vergisi ve kalan krediyi düşerek satıcının eline geçen tutarı tahmin eder. Her sonuç tahminidir."
      />
      <SellerCalculator
        initial={{ salePrice: whole(sp.satis), acquisitionPrice: whole(sp.alis), holdingMonths: whole(sp.ay) }}
        legal={legal}
      />
    </div>
  );
}
