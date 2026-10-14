import { SegmentTabs } from "@/components/ui/segment-tabs";
import { CONTROL_BASE } from "./helpers";

const ITEMS = [
  { id: "genel", href: CONTROL_BASE, label: "Özet" },
  { id: "liste", href: `${CONTROL_BASE}/liste?kpi=active`, label: "Liste" },
  { id: "portallar", href: `${CONTROL_BASE}/portallar`, label: "Portal ilanları" },
  { id: "anomaliler", href: `${CONTROL_BASE}/anomaliler`, label: "Uyarılar" },
  { id: "envanter", href: `${CONTROL_BASE}/envanter`, label: "Portal listesi" },
  { id: "eslesme", href: `${CONTROL_BASE}/eslesme`, label: "Eşleşme" },
  { id: "yetki", href: `${CONTROL_BASE}/yetki`, label: "Yetki kuyruğu" },
  { id: "kapanis", href: `${CONTROL_BASE}/kapanis`, label: "Kapanış kayıpları" },
  { id: "rapor", href: `${CONTROL_BASE}/rapor`, label: "Rapor" },
] as const;

export type ControlTab = (typeof ITEMS)[number]["id"];

/**
 * TEK İlan Kontrol alt gezinmesi (etkin sekme aria-current): Özet · Liste · Portal ilanları (teyit/yenileme/kapanış kaydı) ·
 * Uyarılar · Portal listesi (envanter karşılaştırma) · Eşleşme · Yetki kuyruğu (EİDS) · Kapanış kayıpları · Rapor. Tüm sekmeler
 * `/app/ilan-kontrol` altındadır. Eklenti kurulum sayfası (`/eklenti`) sekme değildir. "Kapanış kayıpları" (kapanış kaydı + kaçan
 * komisyon tutarı) kullanıcının `leak` modülü yoksa (`closures={false}`) gösterilmez.
 */
export function ControlSubNav({ active, closures = true }: { active: ControlTab; closures?: boolean }) {
  const items = ITEMS.filter((i) => i.id !== "kapanis" || closures);
  return <SegmentTabs className="mb-5" label="İlan kontrol bölümleri" active={active} items={items} />;
}
