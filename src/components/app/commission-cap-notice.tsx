import { Alert } from "@/components/ui/alert";
import { checkCommissionCap, type CommissionCapInput } from "@/lib/commission-cap";

const tl = (n: number) =>
  new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 2 }).format(n);

/**
 * Komisyon tavan uyarısı. Tavan aşılmazsa (veya girdi eksikse) hiçbir şey çizmez.
 * Mevzuat parametreleri `CommissionCapInput` içinden geçilir.
 */
export function CommissionCapNotice({ className, ...input }: CommissionCapInput & { className?: string }) {
  const r = checkCommissionCap(input);
  if (!r.valid || !r.exceeds) return null;
  const kindText = input.kind === "sale" ? "satış bedelinin" : "aylık kiranın";
  return (
    <Alert tone="warning" title="Komisyon, varsayılan üst sınırı aşıyor" className={className}>
      <p>
        İstenen komisyon (KDV hariç) {tl(r.requestedNet)}; {kindText} üst sınırı {tl(r.capNet)}. Aşan kısım{" "}
        {tl(r.excessNet)} (KDV dahil {tl(r.excessGross)}).
      </p>
      <p className="mt-1 opacity-80">
        Bu bir hesaplama uyarısıdır, hukuki danışmanlık değildir. Sınır değerleri parametredir; mevzuatı doğrulayın.
      </p>
    </Alert>
  );
}
