import { FontScaleController } from "@/components/font-scale-controller";
import { fontScaleCss, type FontScale } from "@/lib/font-scale";

/** Kabuk (layout) içinde: SSR stili (ilk boyama) + istemci denetleyicisi (önizleme/temizlik). */
export function FontScaleBoot({ scale }: { scale: FontScale }) {
  const css = fontScaleCss(scale);
  return (
    <>
      {css ? <style>{css}</style> : null}
      <FontScaleController scale={scale} />
    </>
  );
}
