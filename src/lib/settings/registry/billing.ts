import type { AnySettingDef } from "../types";
import { defineBool } from "./define";

/**
 * FATURALAMA ayarları (platform kapsamı, `platform_settings` deposu). `platform.ts`'ten ayrı tutulur: abonelik
 * yaşam döngüsünün YENİ bayrakları buraya eklenir (platform.ts ilk dalga sabitlerini kilitler).
 */
export const BILLING_SETTING_DEFS: AnySettingDef[] = [
  defineBool({
    key: "billing.expire_to_past_due",
    default: false,
    category: "deneme-yenileme",
    label: "Dönemi biten aboneliği gecikmişe çevir",
    description:
      "Günlük abonelik kontrolü, ödenmiş dönemi bittiği halde 'aktif' görünen aboneliği 'gecikmiş' yapar; ofis aktifse o da gecikmişe geçer ve ofise bildirim gider.",
    impact:
      "Açılırsa yenilemesi alınmamış ofisler ertesi gece gecikmiş olur ve tahsilat akışına girer. Açmadan önce kontrol panelindeki 'Dönemi bitmiş ama aktif' kuyruğunu inceleyin; kapalıyken otomatik geçiş olmaz.",
    risk: "high",
  }),
];
