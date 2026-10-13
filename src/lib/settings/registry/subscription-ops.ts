import type { AnySettingDef } from "../types";
import { defineInt } from "./define";
import { BILLING_HOME } from "./platform";

/**
 * ABONELİK OPERASYON KONSOLU ayarları (AD1; Ofis 360 > Abonelik). Ayrı dosya: diğer paketlerin registry
 * dosyalarıyla çakışmasın diye (index'te tek satır).
 */
export const SUBSCRIPTION_OPS_SETTING_DEFS: AnySettingDef[] = [
  defineInt({
    key: "billing.admin_invoice_due_days",
    home: BILLING_HOME,
    default: 7,
    min: 1,
    max: 60,
    unit: "gün",
    category: "faturalama",
    label: "Yönetici fark faturası vadesi",
    description:
      "Ofis 360'tan kıst hesaplı paket yükseltmesi ya da ücretli ek koltuk verildiğinde kesilen fark faturasının vadesi (bugünden itibaren gün).",
    impact: "Yalnız bundan sonra kesilen yönetici faturalarını etkiler. Vadesi geçen fatura her zamanki hatırlatma (dunning) akışına girer.",
  }),
];
