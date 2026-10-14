import type { AnySettingDef } from "../types";
import { defineBool } from "./define";

/**
 * YD3 randevu iletişimi (ofis kapsamı, `tenant_settings`). Varsayılan KAPALI = bugünkü davranış: müşteriye otomatik
 * ileti gitmez; danışman randevu satırından hazır metinli "WhatsApp'ta teyit gönder" bağlantısını kullanır.
 * Okuyucular: `createAppointment` (teyit SMS'i) ve `randevu-hatirlat` cron'unun müşteri adımı (24 saat içi hatırlatma).
 * İletiler İŞLEM AMAÇLIDIR (İYS muaf, `appointment_reminder`); gönderim günlüğe "Randevu teyidi/hatırlatması" olarak düşer.
 */
export const APPOINTMENT_CUSTOMER_SMS_KEY = "office.appointment.customer_sms";

export const APPOINTMENT_SETTING_DEFS: AnySettingDef[] = [
  defineBool({
    scope: "tenant",
    storage: "tenant_settings",
    permission: { appModule: "settings" },
    category: "bayrak",
    group: "iletisim",
    key: APPOINTMENT_CUSTOMER_SMS_KEY,
    default: false,
    label: "Müşteriye randevu teyit ve hatırlatma SMS'i",
    description:
      "Randevu açılınca müşteriye teyit bağlantılı SMS gider; randevudan önceki 24 saat içinde (09:00–21:00 arası) bir kez hatırlatma SMS'i gönderilir. Ofisin SMS hesabı bağlı ve müşterinin cep telefonu kayıtlı olmalıdır.",
    impact:
      "Açılırsa iletiler işlem amaçlı (İYS muaf) olarak gönderilir ve SMS kredisi harcar. SMS hesabı yoksa hiçbir şey gönderilmez; danışman randevu satırındaki \"WhatsApp'ta teyit gönder\" bağlantısıyla elle iletir. Danışman hatırlatması bu ayardan bağımsızdır.",
  }),
];
