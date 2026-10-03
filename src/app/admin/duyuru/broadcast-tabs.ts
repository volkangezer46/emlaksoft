/**
 * Yeni duyuru formunun sekme tanımı (veri: ikon yok) — form bileşeni ve
 * `src/lib/form-tabs-contract.test.ts` aynı kaynağı kullanır.
 */
export const BROADCAST_FORM_ID = "yeni-platform-duyurusu";

export const BROADCAST_TABS = [
  {
    id: "icerik",
    label: "İçerik",
    description: "Ofis kullanıcılarının bildirim kutusunda göreceği başlık, mesaj ve bağlantı.",
    fields: ["title", "body", "href"],
    required: ["title"],
  },
  {
    id: "hedef",
    label: "Tür ve hedef",
    description: "Bildirimin türü ve hangi ofislere gideceği. Gönderim geri alınamaz.",
    fields: ["kind", "target", "tenant_id"],
    required: [],
  },
] as const;

/** Duyuru metni kişisel/hassas olabilir; taslak kullanılmaz. */
export const BROADCAST_DRAFT_FIELDS = [] as const;
