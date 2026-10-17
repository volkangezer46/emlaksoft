import { zekaSurfaceEnabled } from "@/lib/ai/zeka/settings";
import { ZekaFloatingAsk, ZekaHeroAsk } from "./public-ask";

/** Public sayfaların yüzen "EmlakSoft'a sor" girişi; yönetimden yüzey kapatılınca çizilmez (sunucu bileşeni). */
export async function ZekaPublicLauncher() {
  if (!(await zekaSurfaceEnabled("public"))) return null;
  return <ZekaFloatingAsk />;
}

/** Vitrinin yüzen ilan asistanı (o ofisin yayındaki ilanlarında doğal dille arama). */
export async function ZekaVitrinLauncher({ slug }: { slug: string }) {
  if (!(await zekaSurfaceEnabled("vitrin"))) return null;
  return <ZekaFloatingAsk surface="vitrin" extraBody={{ slug }} title="İlan asistanı" placeholder="Örn. Kadıköy'de 3+1, 10 milyon altı" />;
}

/** Ana sayfa kahramanındaki soru kutusu; yüzey kapalıyken çizilmez (kutu görünüp "kapalı" yanıtı vermesin). */
export async function ZekaPublicHeroAsk() {
  if (!(await zekaSurfaceEnabled("public"))) return null;
  return <ZekaHeroAsk />;
}
