"use client";

import { getMergePreview, mergeCustomers } from "@/app/actions/customers";
import { MergeButton, MergePanel as RecordMergePanel, type MergeAdapter } from "@/components/app/record-merge-wizard";
import { formatTurkishPhone } from "@/lib/phone";
import type { DuplicateRecord } from "./groups-client";

/**
 * Müşteri birleştirme sihirbazı (X6 + CRM-G1): ortak `record-merge-wizard` adımları (ana kayıt → alan seçimi → özet →
 * onay) müşteri action'larına bağlanır. Taşıma listesi DB'de dinamik (customers(id)'ye FK veren TÜM tablolar);
 * seçilmeyen telefon/e-posta ve kopya notları ana kaydın notuna eklenir.
 */
const CUSTOMER_ADAPTER: MergeAdapter = {
  noun: "müşteri",
  preview: (primaryId, duplicateIds, overrides) => getMergePreview(primaryId, duplicateIds, overrides),
  merge: (primaryId, duplicateIds, overrides) => mergeCustomers(primaryId, duplicateIds, overrides),
  recordHref: (id) => `/app/musteriler/${id}`,
};

export { MergeButton };

export function MergePanel({ panelId, kayitlar }: { panelId: string; kayitlar: DuplicateRecord[] }) {
  return (
    <RecordMergePanel
      panelId={panelId}
      title="Müşteri kayıtlarını birleştir"
      adapter={CUSTOMER_ADAPTER}
      records={kayitlar.map((k) => ({
        id: k.customer_id,
        title: k.full_name ?? "İsimsiz",
        subtitle: `${k.phone ? formatTurkishPhone(k.phone) : "Telefon yok"} · ${k.email ?? "E-posta yok"}`,
        meta: `${k.activity} kayıt hareketi`,
        score: k.activity,
      }))}
    />
  );
}
