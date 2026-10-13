import type { SeoGlobal } from "@/lib/seo/schema";
import type { SitePageContent } from "../schema-core";
import { ContactBlockView, type ContactInfo } from "./contact";
import { CtaBlockView } from "./cta";
import { FaqBlockView } from "./faq";
import { FeaturesBlockView } from "./features";
import { HeroBlockView } from "./hero";
import { TextBlockView } from "./text";

export type { ContactInfo } from "./contact";

/** Kurum bilgisinden iletişim satırları (adres alanı SEO kurum bilgisinde henüz yok: boş kalır, gösterilmez). */
export function contactInfoFrom(global: Pick<SeoGlobal, "organization">): ContactInfo {
  return { email: global.organization.email, phone: global.organization.phone, address: "" };
}

/**
 * Özel sayfanın blokları (sunucu bileşeni). Herkese açık sayfa ve personel önizlemesi AYNI bileşeni kullanır.
 * Giriş bloğu yoksa görünür bir h1 (sayfa adı) basılır: her sayfada tek ana başlık.
 */
export function SitePageBlocks({ content, contact }: { content: SitePageContent; contact: ContactInfo }) {
  const firstHero = content.blocks.findIndex((b) => b.type === "hero");
  return (
    <>
      {firstHero === -1 ? (
        <div className="mx-auto max-w-3xl px-4 pt-12 sm:px-6">
          <h1 className="font-display text-3xl font-extrabold text-ink-950 sm:text-4xl">{content.title}</h1>
        </div>
      ) : null}
      {content.blocks.map((b, i) => {
        switch (b.type) {
          case "hero":
            return <HeroBlockView key={i} block={b} first={i === firstHero} />;
          case "text":
            return <TextBlockView key={i} block={b} />;
          case "features":
            return <FeaturesBlockView key={i} block={b} />;
          case "faq":
            return <FaqBlockView key={i} block={b} />;
          case "cta":
            return <CtaBlockView key={i} block={b} />;
          case "contact":
            return <ContactBlockView key={i} block={b} info={contact} />;
        }
      })}
    </>
  );
}
