import { canMeasure } from "@/lib/measure/scope";
import { MEASURE_DEFAULTS, getMeasureSettings } from "@/lib/measure/settings";
import { measureScriptProps, measureScriptSrc } from "./script-src";

/**
 * Birinci taraf ölçüm etiketi (SUNUCU bileşeni; istemci React kodu YOK). Yalnız herkese açık sayfalarda:
 *   <script src="/statik/m-<özet>.js" defer data-static-keep data-a="0|1">
 * `data-static-keep` (K4): statik ana sayfa dönüştürücüsü bu etiketi korur. Gömülü HTML'e eklenen tek şey bu etikettir.
 * `path` verilirse kapsam denetlenir (/app, /admin ve giriş/portal yollarında hiç basılmaz); altbilgi gibi yalnız
 * herkese açık sayfalarda kullanılan çağrı yerleri `path` vermeden kullanır.
 */
export async function PublicMeasure({ path }: { path?: string } = {}) {
  // Kapsam dışı yolda ayar bile okunmaz.
  if (path !== undefined && !canMeasure(path)) return null;
  const settings = await getMeasureSettings().catch(() => MEASURE_DEFAULTS);
  const props = measureScriptProps(path, settings, measureScriptSrc());
  if (!props) return null;
  return <script src={props.src} defer data-static-keep="" data-a={props["data-a"]} />;
}
