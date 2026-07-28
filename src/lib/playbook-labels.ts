import type { PlaybookTriggerEvent } from "@/lib/playbook-engine";

/**
 * İş akışı sözlükleri — Türkçe etiketler.
 *
 * NEDEN `playbook-engine.ts` İÇİNDE DEĞİL: motor dosyası `notifyTenant`'ı
 * dinamik import ediyor; onu bir `"use client"` bileşeninden import etmek
 * sunucu-yalnız modülleri istemci paketine sürükler. Etiketler hem sunucu
 * sayfasında hem istemci editöründe gerekiyor, bu yüzden bağımlılıksız ayrı
 * bir modülde duruyorlar (tip importu derlemede silinir).
 */

export const PLAYBOOK_TRIGGER_EVENTS: PlaybookTriggerEvent[] = [
  "yeni_musteri",
  "yeni_portfoy",
  "anlasma_kazanildi",
  "kira_sozlesmesi",
  "talep_olusturuldu",
];

export const PLAYBOOK_TRIGGER_LABELS: Record<PlaybookTriggerEvent, string> = {
  yeni_musteri: "Yeni müşteri eklendi",
  yeni_portfoy: "Yeni portföy eklendi",
  anlasma_kazanildi: "Anlaşma kazanıldı",
  kira_sozlesmesi: "Kira sözleşmesi yapıldı",
  talep_olusturuldu: "Yeni talep oluşturuldu",
};

/** Tetikleyiciye göre filtrede kullanılabilecek alan önerileri (datalist). */
export const PLAYBOOK_FILTER_HINTS: Record<PlaybookTriggerEvent, { key: string; label: string; samples: string[] }[]> = {
  yeni_musteri: [
    { key: "customer_type", label: "Müşteri tipi", samples: ["Alıcı", "Satıcı", "Kiracı", "Ev Sahibi"] },
  ],
  yeni_portfoy: [
    { key: "transaction_type", label: "İşlem türü", samples: ["Satılık", "Kiralık", "Devren", "Günlük Kiralık"] },
    { key: "property_type", label: "Emlak türü", samples: ["Daire", "Villa", "Arsa", "İş Yeri"] },
  ],
  anlasma_kazanildi: [{ key: "deal_type", label: "Anlaşma türü", samples: ["Satış", "Kiralama"] }],
  kira_sozlesmesi: [],
  talep_olusturuldu: [
    { key: "transaction_type", label: "İşlem türü", samples: ["Satılık", "Kiralık"] },
    { key: "property_type", label: "Emlak türü", samples: ["Daire", "Villa", "Arsa", "İş Yeri"] },
  ],
};

/** `tasks.kind` sözlüğü (bkz. 20260722000022_tasks.sql). */
export const PLAYBOOK_KIND_LABELS: Record<string, string> = {
  followup: "Takip",
  call: "Arama",
  visit: "Ziyaret",
  document: "Evrak",
  other: "Diğer",
};

export const PLAYBOOK_PRIORITY_LABELS: Record<string, string> = {
  low: "Düşük",
  normal: "Normal",
  high: "Yüksek",
};

export const PLAYBOOK_ASSIGN_LABELS: Record<string, string> = {
  owner: "Kaydın sorumlusu",
  creator: "İşlemi yapan",
  specific: "Belirli kişi",
};

/** "+0 gün" yerine insan diliyle vade. */
export function offsetLabel(days: number): string {
  if (!Number.isFinite(days) || days <= 0) return "bugün";
  if (days === 1) return "yarın";
  return `${days} gün sonra`;
}
