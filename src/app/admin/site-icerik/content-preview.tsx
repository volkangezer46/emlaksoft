"use client";

import { useMemo, useState, type MouseEvent } from "react";
import { Faq, buildHomeFaqs } from "@/components/marketing/faq";
import { FinalCta } from "@/components/marketing/final-cta";
import { HeroSection } from "@/components/marketing/hero/hero-section";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { SecurityBand } from "@/components/marketing/security-band";
import { TrustStrip } from "@/components/marketing/trust-strip";
import { ValuationSection } from "@/components/marketing/valuation-section";
import { ValueCards } from "@/components/marketing/value-cards";
import { PLANS } from "@/lib/billing/plans";
import type { EfValuationStatus } from "@/lib/site-content/ef-status";
import type { SiteContent } from "@/lib/site-content/schema";
import { btn } from "../site-menu/editor-ui";
import "@/app/marketing.css";
import "@/app/marketing-sections.css";

type Part = "hero" | "cards" | "how" | "security" | "valuation" | "faq" | "final";
const PARTS: Array<{ id: Part; label: string }> = [
  { id: "hero", label: "Ana başlık" },
  { id: "cards", label: "Kartlar ve şerit" },
  { id: "how", label: "Nasıl çalışır" },
  { id: "valuation", label: "Değerleme" },
  { id: "security", label: "Güvenlik" },
  { id: "faq", label: "SSS" },
  { id: "final", label: "Son çağrı" },
];

/**
 * Canlı önizleme: herkese açık sitede çalışan GERÇEK bileşenler taslakla çizilir (bağlantılar önizlemede gezinmez).
 * Deneme günü örnek değerle (14) ve paket tanımları kod içi varsayılandır; gerçek sayfada canlı paket verisi kullanılır.
 */
export function ContentPreview({ cfg }: { cfg: SiteContent }) {
  const [part, setPart] = useState<Part>("hero");
  const [status, setStatus] = useState<EfValuationStatus>("soon");
  const trialDays = 14;
  const faqs = useMemo(() => buildHomeFaqs({ trialDays, plans: PLANS, content: cfg.faq }), [cfg.faq]);
  const block = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest("a")) e.preventDefault();
  };
  return (
    <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-4" aria-label="Canlı önizleme">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-base font-extrabold text-ink-950">Canlı önizleme</h2>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Önizleme bölümü">
          {PARTS.map((p) => (
            <button key={p.id} type="button" className={btn} aria-pressed={part === p.id} onClick={() => setPart(p.id)}>{p.label}</button>
          ))}
        </div>
      </div>
      {part === "valuation" ? (
        <div className="mt-2 flex items-center gap-2 text-xs text-text-muted">
          Özellik durumu (önizleme):
          <button type="button" className={btn} aria-pressed={status === "soon"} onClick={() => setStatus("soon")}>Yakında</button>
          <button type="button" className={btn} aria-pressed={status === "live"} onClick={() => setStatus("live")}>Canlı</button>
        </div>
      ) : null}
      <div className="mk mt-3 max-h-[36rem] overflow-auto rounded-[var(--radius-card)] border border-line" onClickCapture={block}>
        {part === "hero" ? <HeroSection trialDays={trialDays} plans={PLANS} content={cfg.hero} /> : null}
        {part === "cards" ? (
          <>
            <ValueCards trialDays={trialDays} plans={PLANS} content={cfg.valueCards} />
            <TrustStrip trialDays={trialDays} content={cfg.trust} />
          </>
        ) : null}
        {part === "how" ? <HowItWorks trialDays={trialDays} plans={PLANS} steps={cfg.steps} heading={cfg.sections.nasil} /> : null}
        {part === "valuation" ? <ValuationSection status={status} trialDays={trialDays} plans={PLANS} content={cfg.valuation} /> : null}
        {part === "security" ? <SecurityBand trialDays={trialDays} plans={PLANS} content={cfg.security} heading={cfg.sections.guvenlik} /> : null}
        {part === "faq" ? <Faq items={faqs} heading={cfg.sections.sss} /> : null}
        {part === "final" ? <FinalCta trialDays={trialDays} plans={PLANS} content={cfg.finalCta} /> : null}
      </div>
      <p className="mt-2 text-xs text-text-faint">Ürün turu, özellik ızgarası, ayrıntılar ve karşılaştırma bölümlerinin başlıkları sunucuda paket verisiyle çizilir; değişiklik yayınlandığında ana sayfada görünür.</p>
    </section>
  );
}
