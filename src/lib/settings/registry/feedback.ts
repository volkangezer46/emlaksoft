import type { AnySettingDef } from "../types";
import { defineBool, defineInt } from "./define";

/**
 * ÜRÜN GERİ BİLDİRİMİ ayarları (DG8; platform kapsamı, `platform_settings` deposu): ürün içi NPS anketi ve özellik
 * istek panosu. Açık/kapalı ayarlar aynı zamanda HEDEFLENEBİLİR özellik bayrağıdır (`feature-flags/registry.ts`:
 * nps_survey, feature_board); ofis/plan/yüzde/zaman hedeflemesi Ayarlar > Özellik bayrakları ekranındadır.
 */
export const NPS_HOME = { href: "/admin/duyuru?sekme=nps", label: "Toplu duyuru > NPS anketi" } as const;
export const BOARD_HOME = { href: "/admin/tickets/oneriler", label: "Destek > Öneri panosu" } as const;

export const FEEDBACK_SETTING_KEYS = {
  npsEnabled: "feedback.nps_enabled",
  npsIntervalDays: "feedback.nps_interval_days",
  boardEnabled: "feedback.board_enabled",
} as const;

/** NPS sıklık sınırının varsayılanı (gün): bir kullanıcıya en fazla bu aralıkla bir anket gösterilir. */
export const NPS_INTERVAL_DEFAULT_DAYS = 90;

export const FEEDBACK_SETTING_DEFS: AnySettingDef[] = [
  defineBool({
    key: FEEDBACK_SETTING_KEYS.npsEnabled,
    home: NPS_HOME,
    default: true,
    category: "bayrak",
    label: "Ürün içi NPS anketi",
    description: "Açıkken yayındaki NPS anketi hedef ofislerin kullanıcılarına sıklık sınırıyla gösterilir.",
    impact: "Kapatınca anket hemen gizlenir (yanıtlar korunur). Ofis/plan/yüzde hedeflemesi Özellik bayrakları ekranında.",
  }),
  defineInt({
    key: FEEDBACK_SETTING_KEYS.npsIntervalDays,
    home: NPS_HOME,
    default: NPS_INTERVAL_DEFAULT_DAYS,
    min: 7,
    max: 365,
    category: "bildirim",
    label: "NPS sıklık sınırı (gün)",
    description: "Bir kullanıcıya en fazla kaç günde bir NPS anketi gösterileceği (yanıtlasa da kapatsa da gösterim sayılır).",
    impact: "Küçültmek daha çok yanıt getirir ama kullanıcıyı yorar; sınır veritabanı işleminde de uygulanır.",
    permission: { platformModule: "broadcast", superAdminOnly: true },
  }),
  defineBool({
    key: FEEDBACK_SETTING_KEYS.boardEnabled,
    home: BOARD_HOME,
    default: true,
    category: "bayrak",
    label: "Özellik istek panosu",
    description: "Açıkken ofisler Yardım > Öneri panosu'nda öneri yazar ve oy verir (ofis başına tek oy).",
    impact: "Kapatınca sekme gizlenir, yeni öneri ve oy kabul edilmez; mevcut öneriler ve oylar korunur.",
  }),
];
