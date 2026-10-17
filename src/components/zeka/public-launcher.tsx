import { zekaSurfaceEnabled } from "@/lib/ai/zeka/settings";
import { ZekaHeroAsk } from "./public-ask";
import { ZekaFab } from "./zeka-fab";

/**
 * Public sayfaların yüzen "Zeka'ya sor" düğmesi (ana sayfa, fiyatlar, özellik/site sayfaları, araçlar, rehber); yönetimden
 * yüzey kapatılınca çizilmez (sunucu bileşeni). Düğme küçük adadır; sohbet penceresi ilk tıkta iner.
 */
export async function ZekaPublicLauncher() {
  if (!(await zekaSurfaceEnabled("public"))) return null;
  return <ZekaFab surface="public" title="EmlakSoft'a sor" placeholder="Fiyat, özellik ya da kullanım sorun…" />;
}

/** Vitrinin yüzen ilan asistanı (o ofisin yayındaki ilanlarında doğal dille arama). */
export async function ZekaVitrinLauncher({ slug }: { slug: string }) {
  if (!(await zekaSurfaceEnabled("vitrin"))) return null;
  return <ZekaFab surface="vitrin" extraBody={{ slug }} title="İlan asistanı" placeholder="Örn. Kadıköy'de 3+1, 10 milyon altı" />;
}

/** Ana sayfa kahramanındaki soru kutusu; yüzey kapalıyken çizilmez (kutu görünüp "kapalı" yanıtı vermesin). */
export async function ZekaPublicHeroAsk() {
  if (!(await zekaSurfaceEnabled("public"))) return null;
  return <ZekaHeroAsk />;
}
