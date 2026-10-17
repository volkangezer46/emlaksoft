import type { ReactNode } from "react";
import { ZekaHeroAsk } from "@/components/zeka/public-ask";
import { CalendarCheck, Zap } from "lucide-react";
import { HeroScene } from "./hero-scene";
import { HeroPhoneScene } from "./hero-phone";
import { PortalStrip } from "../portal-strip";
import { ContentLink, Lines } from "../content-link";
import type { PlanDef } from "@/lib/billing/plans";
import { defaultSiteContent } from "@/lib/site-content/defaults";
import { heroMobileCopy } from "@/lib/site-content/hero-mobile";
import type { SiteContent } from "@/lib/site-content/schema";
import { tx } from "@/lib/site-content/tokens";
import { SpriteIcon } from "@/components/icons/sprite-icon";

/** Masaüstü/mobil metin çifti: aynıysa tek metin; farklıysa CSS kırılımı (768 px) hangisinin görüneceğini seçer. */
function Pair({ desk, mobile }: { desk: string; mobile: string }) {
  if (desk === mobile) return <>{desk}</>;
  return (
    <>
      <span className="mk-dl">{desk}</span>
      <span className="mk-ml">{mobile}</span>
    </>
  );
}

/**
 * Hero: sol metin bloğu + sağ ürün sahnesi. Sunucu bileşeni, istemci JS yok. Metinler site içeriğinden (varsayılan = bugünkü metin).
 * Mobil (< 768 px): tek cümle açıklama (`hero.mobileLead`), kısa düğme etiketi, metin bağlantısı, sıkı güven çipleri ve
 * telefon sahnesi (HeroPhoneScene); EmlakFiyati satırı mobilde gizlidir (kendi bölümünde durur). Masaüstü çıktı değişmez.
 * DÜRÜST DURUM: `efLive` fiyat bölümüyle aynı kaynaktan (getPublicPricing); false iken EmlakFiyati rozeti "Yakında" der.
 * GÖRSEL (SP6): `image` verilirse sağ sütundaki ürün sahnesi yerine onun çizdiği öğe gelir (sahne yedek olarak verilir;
 * medya okunamazsa sahne kalır). Verilmezse çıktı birebir bugünkü gibidir.
 * YERİNDE DÜZENLEME: `cms` YALNIZ taslak önizlemesinde verilir; metin düğümlerine `data-cms-path` ekler. Canlı/statik
 * HTML'de bu öznitelik hiç yoktur.
 */
export function HeroSection({
  trialDays,
  plans = [],
  content = defaultSiteContent().hero,
  efLive,
  image,
  cms = false,
}: {
  trialDays?: number;
  plans?: readonly PlanDef[];
  content?: SiteContent["hero"];
  /** EmlakFiyati canlı mı (public-state). Verilmezse rozet metni aynen kalır (önizleme/test). */
  efLive?: boolean;
  /** Hero görseli çizici (sunucuda medya kaydını okur); argüman = yedek ürün sahnesi. */
  image?: (scene: ReactNode) => ReactNode;
  /** Taslak önizlemesi: düzenlenebilir metinlere `data-cms-path` ekle. */
  cms?: boolean;
}) {
  const at = (path: string) => (cms ? { "data-cms-path": path } : {});
  const cmsLabel = (path: string, node: ReactNode) => (cms ? <span data-cms-path={path}>{node}</span> : node);
  const scene = (
    <>
      <HeroPhoneScene />
      <HeroScene />
    </>
  );
  const ctx = { trialDays, plans, efLive };
  const m = heroMobileCopy(content, ctx);
  const strip = content.portalStrip ?? defaultSiteContent().hero.portalStrip;
  return (
    <>
    <section className="mk-hero" aria-labelledby="hero-baslik">
      <div className="mk-hero-bg" aria-hidden="true" />
      <div className="mk-wrap mk-wrap-wide mk-hero-grid">
        <div className="mk-hero-copy">
          <p className="mk-badge" {...at("hero.badge")}><Zap size={15} aria-hidden="true" />{tx(content.badge, ctx)}</p>
          <h1 id="hero-baslik" className="mk-h1" {...at("hero.title")}>
            {content.title ? `${content.title} ` : null}
            {content.em ? <span className="mk-grad">{content.em}</span> : null}
            {content.tail ? ` ${content.tail}` : null}
          </h1>
          <p className="mk-hero-lead" {...at("hero.lead")}><Lines text={tx(content.lead, ctx)} /></p>
          {m.lead ? <p className="mk-hero-lead-m" {...at("hero.mobileLead")}>{m.lead}</p> : null}
          {content.integrationBadge || content.integrationLine ? (
            <p className="mk-hero-int" data-hero-integration="" {...at("hero.integrationLine")}>
              {content.integrationBadge ? <a href="#degerleme" className="mk-tag mk-tag-plan">{efLive === false ? `${tx(content.integrationBadge, ctx)} · Yakında` : tx(content.integrationBadge, ctx)}</a> : null}
              {content.integrationBadge && content.integrationLine ? " " : null}
              {content.integrationLine ? tx(content.integrationLine, ctx) : null}
            </p>
          ) : null}
          <div className="mk-cta-row">
            <ContentLink href={content.primary.href} className="mk-btn mk-btn-grad btn-shine mk-hero-primary">{cmsLabel("hero.primary.label", <Pair desk={tx(content.primary.label, ctx)} mobile={m.primary} />)} <SpriteIcon name="arrow-right" size={18} /></ContentLink>
            <ContentLink href={content.secondary.href} className="mk-btn mk-btn-ghost mk-hero-secondary"><CalendarCheck size={18} aria-hidden="true" />{cmsLabel("hero.secondary.label", <Pair desk={tx(content.secondary.label, ctx)} mobile={m.secondary} />)}<SpriteIcon name="arrow-right" size={16} className="mk-ml" /></ContentLink>
          </div>
          <ZekaHeroAsk />
          <ul className="mk-checks">
            {m.checks.map((c) => <li key={c.id} {...at(`hero.checks.${content.checks.findIndex((x) => x.id === c.id)}.text`)}><SpriteIcon name="check" size={16} /><Pair desk={c.text} mobile={c.short} /></li>)}
          </ul>
        </div>
        {image ? image(scene) : scene}
      </div>
    </section>
    {/* Portal şeridi hero kutusunun DIŞINDA: hero yüksekliği (1440'ta <=780px hedefi) şeritten bağımsız. Yalnız gizli değilse, içerikten. */}
    {strip.hidden ? null : <PortalStrip content={{ ...strip, title: tx(strip.title, ctx), text: tx(strip.text, ctx), note: tx(strip.note, ctx) }} />}
    </>
  );
}
