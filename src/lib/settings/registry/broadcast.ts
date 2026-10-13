import type { AnySettingDef } from "../types";
import { defineInt } from "./define";

/**
 * DUYURU MERKEZİ ayarları (AD8; platform kapsamı, `platform_settings` deposu). Kuyruk hızı ve süre bütçesi adminden
 * değiştirilebilir; varsayılanlar güvenli (2 dakikalık cron adımı + gönderim anında after() içinde ~25 sn).
 */
export const BROADCAST_HOME = { href: "/admin/duyuru", label: "Toplu duyuru" } as const;

export const BROADCAST_SETTING_KEYS = {
  batchSize: "broadcast.queue_batch_size",
  budgetSeconds: "broadcast.queue_budget_seconds",
} as const;

export const BROADCAST_SETTING_DEFS: AnySettingDef[] = [
  defineInt({
    key: BROADCAST_SETTING_KEYS.batchSize,
    home: BROADCAST_HOME,
    default: 200,
    min: 20,
    max: 1000,
    category: "bildirim",
    label: "Duyuru kuyruğu parti boyutu",
    description: "Duyuru kuyruğunun tek turda sahiplenip gönderdiği alıcı-kanal satırı sayısı.",
    impact: "Büyütmek gönderimi hızlandırır ama e-posta sağlayıcısının hız sınırına daha çabuk takılır; küçültmek yükü yayar.",
    permission: { platformModule: "broadcast", superAdminOnly: true },
  }),
  defineInt({
    key: BROADCAST_SETTING_KEYS.budgetSeconds,
    home: BROADCAST_HOME,
    default: 25,
    min: 5,
    max: 45,
    category: "bildirim",
    label: "Duyuru kuyruğu süre bütçesi (sn)",
    description: "Kuyruğun bir çalıştırmada en çok kaç saniye gönderim yapacağı; kalan iş 2 dakika sonraki çalıştırmaya kalır.",
    impact: "Cron ucu 60 sn ile sınırlıdır; 45 sn üstü desteklenmez. Düşük değer gönderimi uzatır ama sunucuyu rahatlatır.",
    permission: { platformModule: "broadcast", superAdminOnly: true },
  }),
];
