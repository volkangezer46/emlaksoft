import { SegmentTabs } from "@/components/ui/segment-tabs";
import { CONTROL_BASE } from "./helpers";

/** Kayıp-Kaçak Kalkanı sayfası (yol DEĞİŞMEZ; nav-config kuralı). İlan Kontrol alt gezinmesinin "Kapanış kayıpları" sekmesi. */
export const CLOSURE_LOSSES_HREF = "/app/kayip-kacak";

const ITEMS = [
  { id: "genel", href: CONTROL_BASE, label: "Özet" },
  { id: "liste", href: `${CONTROL_BASE}/liste?kpi=active`, label: "Liste" },
  { id: "anomaliler", href: `${CONTROL_BASE}/anomaliler`, label: "Uyarılar" },
  { id: "envanter", href: `${CONTROL_BASE}/envanter`, label: "Portal listesi" },
  { id: "eslesme", href: `${CONTROL_BASE}/eslesme`, label: "Eşleşme" },
  { id: "yetki", href: `${CONTROL_BASE}/yetki`, label: "Yetki kuyruğu" },
  { id: "kapanis", href: CLOSURE_LOSSES_HREF, label: "Kapanış kayıpları" },
  { id: "rapor", href: `${CONTROL_BASE}/rapor`, label: "Rapor" },
] as const;

export type ControlTab = (typeof ITEMS)[number]["id"];

/**
 * TEK "Kayıp-Kaçak / İlan Kontrol Merkezi" alt gezinmesi (sayfa içi sekme: yollar sabit; etkin sekme aria-current).
 * Özet · Liste · Uyarılar · Portal listesi (envanter karşılaştırma) · Eşleşme · Yetki kuyruğu (EİDS yetki durumu) · Kapanış kayıpları · Rapor. Eklenti kurulum
 * sayfası (`/eklenti`) sekme değildir: işçi durum satırı ve envanter ekranı oraya bağlanır. "Kapanış kayıpları" Kayıp-Kaçak Kalkanı sayfasıdır
 * (`/app/kayip-kacak`: kapanış kaydı + kaçan komisyon tutarı); kullanıcının `leak` modülü yoksa (`closures={false}`)
 * sekme hiç gösterilmez. Kalkan sayfası da aynı şeridi `active="kapanis"` ile gösterir: iki ekran tek merkezdir.
 */
export function ControlSubNav({ active, closures = true }: { active: ControlTab; closures?: boolean }) {
  const items = ITEMS.filter((i) => i.id !== "kapanis" || closures);
  return <SegmentTabs className="mb-5" label="İlan kontrol bölümleri" active={active} items={items} />;
}
