import type { AnySettingDef } from "../types";
import { DEFAULT_VAT_SCHEDULE, parseVatSchedule } from "@/lib/billing/plans";
import { defineInt, defineString } from "./define";

/**
 * AD2 — elle fatura / tek seferlik ücret ayarları (platform kapsamı, `platform_settings` deposu). Tek düzenleme yeri
 * "Yeni fatura" ekranının Ayarlar bölümüdür (merkez oraya bağlanır).
 */
export const INVOICE_HOME = { href: "/admin/billing/faturalar/yeni#ayarlar", label: "Abonelik & fatura > Yeni fatura > Ayarlar" } as const;

const vatBase = defineString({
  key: "billing.vat_rate",
  home: INVOICE_HOME,
  default: DEFAULT_VAT_SCHEDULE,
  maxLength: 400,
  minLength: 12,
  category: "faturalama",
  label: "Fatura KDV oranı (geçerlilik tarihli)",
  description:
    "Elle kesilen fatura ve tek seferlik ücretlerde uygulanan KDV oranı. Biçim: 'YYYY-AA-GG=oran' (yüzde), birden çok kayıt ';' ile: örnek '2000-01-01=20; 2027-01-01=18'. Her kayıt o günün başından (TR saati) itibaren geçerlidir.",
  impact:
    "Yeni kesilen elle faturalar, kesim günündeki oranla hesaplanır. Önceden kesilmiş faturalar DEĞİŞMEZ (oran fatura satırında saklıdır). Kartla otomatik abonelik/paket faturaları ödeme sözleşmesi gereği %20 sabitiyle kesilmeye devam eder.",
  risk: "high",
});

export const AD2_INVOICE_SETTING_DEFS: AnySettingDef[] = [
  {
    ...vatBase,
    schema: vatBase.schema.refine((v) => parseVatSchedule(v) !== null, "Geçersiz biçim: 'YYYY-AA-GG=oran' kayıtları ';' ile ayrılmalı (oran 0-99)."),
    codec: { parse: (raw) => (raw != null && parseVatSchedule(raw) ? raw : DEFAULT_VAT_SCHEDULE), format: (v) => v },
  },
  defineInt({
    key: "billing.manual_invoice_due_days",
    home: INVOICE_HOME,
    default: 14,
    min: 0,
    max: 120,
    unit: "gün",
    category: "faturalama",
    label: "Elle fatura vade süresi",
    description: "Taslak fatura kesildiğinde vade tarihi, kesim anından bu kadar gün sonrasına konur (0 = kesim günü).",
    impact: "Yalnız bundan sonra kesilen elle faturaların vadesini değiştirir; vadesi geçen açık fatura gecikmiş sayılır ve hatırlatma akışına girer.",
    permission: { platformModule: "billing" },
  }),
];
