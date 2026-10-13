/**
 * Yeni duyuru formunun sekme tanımı (veri: ikon yok) — form bileşeni ve
 * `src/lib/form-tabs-contract.test.ts` aynı kaynağı kullanır. Hedef sekmesinin `seg_*` alanları
 * segment oluşturucudan (`segment-builder.tsx`) gelir.
 */
export const BROADCAST_FORM_ID = "yeni-platform-duyurusu";

export const BROADCAST_TABS = [
  {
    id: "icerik",
    label: "İçerik",
    description: "Ofis kullanıcılarının göreceği başlık, mesaj, bağlantı ve tür.",
    fields: ["title", "body", "href", "kind"],
    required: ["title"],
  },
  {
    id: "hedef",
    label: "Hedef kitle",
    description: "Segment: plan, durum, deneme bitişi, son giriş, il, modül, rol; ya da tek ofis / tek kullanıcı. Sayı canlı hesaplanır.",
    fields: [
      "seg_status",
      "seg_plan",
      "seg_trial_days",
      "seg_city",
      "seg_login_mode",
      "seg_login_days",
      "seg_module",
      "seg_module_state",
      "seg_tenant",
      "seg_user",
      "seg_owners",
    ],
    required: [],
  },
  {
    id: "kanal",
    label: "Kanal ve zaman",
    description: "Uygulama içi, e-posta ve push; hemen ya da ileri bir saatte; isteğe bağlı bitiş. Ticari iletide yalnız izinli kullanıcılar.",
    fields: ["channel", "commercial", "scheduled_at", "expires_at"],
    required: [],
  },
] as const;

/** Duyuru metni kişisel/hassas olabilir; taslak kullanılmaz. */
export const BROADCAST_DRAFT_FIELDS = [] as const;
