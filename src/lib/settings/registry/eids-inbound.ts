import type { AnySettingDef } from "../types";
import { defineBool } from "./define";

/**
 * EP3 — Bakanlık (EİDS) e-postaları: ofis ayarları (Ofis Tanımları Merkezi > Uyum ve veri paylaşımı).
 * Varsayılanlar sahip kararıdır (2026-10-13): doğrulanmış (DKIM/ARC) VE taşınmaz no ile birebir eşleşen e-posta
 * otomatik uygulanır (geri alınabilir); diğerleri onay kuyruğuna düşer. Okuyucu: `src/lib/eids/inbound.ts`.
 */

const TENANT = {
  scope: "tenant",
  storage: "tenant_settings",
  permission: { appModule: "settings" },
  category: "bayrak",
} as const;

export const EIDS_INBOUND_AUTO_APPLY_KEY = "office.eids.inbound_auto_apply";

export const EIDS_INBOUND_SETTING_DEFS: AnySettingDef[] = [
  defineBool({
    ...TENANT,
    key: EIDS_INBOUND_AUTO_APPLY_KEY,
    group: "uyum",
    default: true,
    label: "Doğrulanmış Bakanlık e-postasını otomatik uygula",
    description:
      "Açıkken, kaynağı DKIM ya da güvenilir iletim zinciriyle (ARC) doğrulanan ve taşınmaz numarası tek bir portföyle birebir eşleşen EİDS e-postası (yetki verildi / iptal edildi) portföyün yetki durumuna kendiliğinden işlenir.",
    impact:
      "Kapalıyken her e-posta İlan Kontrol > Yetki > Kontrol bekliyor listesine düşer ve ofis sahibi, genel müdür ya da şube müdürü onaylamadan hiçbir durum değişmez. Doğrulanamayan, yapıştırılan ve eşleşmesi belirsiz e-postalar her durumda onay bekler. Otomatik uygulanan işlem yetki geçmişinden geri alınabilir.",
  }),
];
