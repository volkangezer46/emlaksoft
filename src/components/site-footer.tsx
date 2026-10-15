import Link from "next/link";
import { Brand } from "@/components/brand/brand";
import { FileSignature } from "lucide-react";
import { getPublicPlanDefinitions } from "@/lib/billing/plan-definitions";
import { now, trParts } from "@/lib/clock";
import { trialCtaMobileLabel } from "@/lib/marketing-copy";
import { formatPhoneDisplay } from "@/lib/phone";
import { getSeoSettings } from "@/lib/seo/store";
import { splitYear, toPublicCtas, toPublicMenu } from "@/lib/site-menu/public";
import { checkPageHref, isExternalHref, type CtaLink, type FooterBadgeIcon } from "@/lib/site-menu/schema-core";
import { getLiveSiteMenu } from "@/lib/site-menu/store";
import { applySupportEmail } from "@/lib/site-menu/support-contact";
import { getSupportContact } from "@/lib/contact-info-server";
import { SpriteIcon } from "@/components/icons/sprite-icon";
import { PublicMeasure } from "@/components/public-measure/public-measure";

/**
 * Alt bilgi sütunları, marka bloğu (açıklama, güven rozetleri, düğme, telif ve yasal not) ve mobil alt çubuk düğmeleri
 * admin'den (Site menüsü) yönetilir; yayın yoksa varsayılan içerik kullanılır (src/lib/site-menu/defaults.ts, bugünkü metin).
 * Sunucu bileşeni: istemciye JS göndermez. `autoPlans` sütununa (varsayılan: "Paketler") paket bağlantıları etkin plan
 * tanımlarından (fiyat okuyucu) eklenir. "İletişim satırı" açıksa sosyal/iletişim bilgisi SEO kurum ayarından okunur.
 * Metinler düz metindir (HTML/markdown işlenmez).
 */
export async function SiteFooter({ smartCta = false, trialDays }: { smartCta?: boolean; trialDays?: number } = {}) {
  const [rawCfg, support] = await Promise.all([getLiveSiteMenu(), getSupportContact()]);
  const cfg = applySupportEmail(rawCfg, support.email);
  const menuColumns = toPublicMenu(cfg, now()).footer;
  const brand = cfg.footerBrand;
  const ctas = toPublicCtas(cfg.ctas);
  const brandCta: CtaLink = checkPageHref(brand.cta.href).ok && brand.cta.label ? brand.cta : { label: "Ücretsiz dene", href: "/kayit" };
  const contact = brand.showContact ? await footerContact() : null;
  const plans = menuColumns.some((c) => c.autoPlans) ? await getPublicPlanDefinitions() : [];
  const columns = menuColumns.map((c) =>
    c.autoPlans
      ? { ...c, links: [...plans.map((p) => ({ id: `plan-${p.id}`, label: p.name, href: `/kayit?plan=${p.id}`, external: false })), ...c.links] }
      : c,
  );
  return (
    <footer className="mk-foot">
      <div className="mk-wrap" style={{ paddingBlock: "clamp(3rem, 2rem + 4vw, 5rem)" }}>
        <div className="mk-foot-grid" style={{ "--mk-foot-cols": Math.min(Math.max(columns.length, 1), 5) } as React.CSSProperties}>
          <div className="mk-foot-brand">
            <Link prefetch={false} href="/" className="mk-logo" style={{ color: "#fff" }} aria-label="EmlakSoft ana sayfa">
              <Brand variant="horizontal" tone="dark" height={36} alt="" lazy />
            </Link>
            {brand.description ? (
              <p style={{ margin: "1rem 0 0", maxWidth: "18rem", fontSize: "0.9375rem", lineHeight: 1.6 }}>
                {brand.description}
              </p>
            ) : null}
            {brand.badges.length ? (
              <ul className="mk-foot-badges" aria-label="Güven başlıkları">
                {brand.badges.map((b, i) => (
                  <li key={i}><BadgeIcon icon={b.icon} />{b.label}</li>
                ))}
              </ul>
            ) : null}
            {contact && contact.length ? (
              <ul className="mk-foot-badges" aria-label="İletişim ve sosyal medya">
                {contact.map((c) => (
                  <li key={c.href}>
                    <a href={c.href} {...(c.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
                      {c.label}
                      {c.external ? <span className="sr-only"> (yeni sekmede açılır)</span> : null}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
            <FootCta cta={brandCta} className="mk-btn mk-btn-light" style={{ marginTop: "1.25rem", minHeight: "2.75rem", padding: "0.5rem 1rem", fontSize: "0.9375rem" }}>
              {`${brandCta.label} `}<SpriteIcon name="arrow-right" size={16} />
            </FootCta>
          </div>
          {columns.map((col) => (
            <nav key={col.id} aria-label={col.title} className="mk-foot-col">
              <h2>{col.title}</h2>
              <FootLinks links={col.links} />
            </nav>
          ))}
          {/* Mobil (< 768 px): aynı gruplar JS'siz akordeon; masaüstünde gizli (display:none => yinelenen bağlantı erişilebilirlik ağacına girmez). */}
          <div className="mk-foot-acc">
            {columns.map((col) => (
              <details key={col.id} className="mk-foot-acc-item">
                <summary>{col.title}<i aria-hidden="true" /></summary>
                <FootLinks links={col.links} />
              </details>
            ))}
          </div>
        </div>
        <div className="mk-foot-bottom">
          {brand.copyright ? <p style={{ margin: 0 }}>{splitYear(brand.copyright, trParts().year)}</p> : null}
          {brand.disclaimer ? <p style={{ margin: 0 }}>{brand.disclaimer}</p> : null}
        </div>
      </div>
      {/* Mobil alt çubuk (< 768 px). smartCta: ana sayfada yalnız hero CTA'sı görünüm dışındayken belirir (MotionRoot). */}
      <div className="mk-sticky-cta" data-smart={smartCta ? "" : undefined}>
        <FootCta cta={ctas.mobileLogin} className="mk-sticky-login">{ctas.mobileLogin.label}</FootCta>
        <FootCta cta={ctas.mobileTrial} className="mk-btn mk-btn-grad">{ctas.mobileTrial.label || trialCtaMobileLabel(trialDays)}</FootCta>
      </div>
      <PublicMeasure />
    </footer>
  );
}

const SPRITE_BADGES = new Set<FooterBadgeIcon>(["shield-check", "scale", "check", "clock"]);

function BadgeIcon({ icon }: { icon: FooterBadgeIcon }) {
  if (icon === "file-signature") return <FileSignature size={15} aria-hidden="true" />;
  if (SPRITE_BADGES.has(icon)) return <SpriteIcon name={icon as "shield-check" | "scale" | "check" | "clock"} size={15} />;
  return null;
}

/** Site yolu Next bağlantısı; https adresi yeni sekmede (yönetimden yalnız bu ikisi kaydedilebilir). */
function FootCta({ cta, className, style, children }: { cta: CtaLink; className?: string; style?: React.CSSProperties; children: React.ReactNode }) {
  if (cta.href.startsWith("/")) {
    return <Link prefetch={false} href={cta.href} className={className} style={style}>{children}</Link>;
  }
  return <a href={cta.href} className={className} style={style} target="_blank" rel="noopener noreferrer">{children}</a>;
}

const SOCIAL_NAMES: Record<string, string> = {
  "instagram.com": "Instagram",
  "linkedin.com": "LinkedIn",
  "x.com": "X",
  "twitter.com": "X",
  "facebook.com": "Facebook",
  "youtube.com": "YouTube",
  "tiktok.com": "TikTok",
};

/** SEO kurum bilgisinden iletişim satırı (salt okuma; okunamazsa satır çizilmez). */
async function footerContact(): Promise<Array<{ href: string; label: string; external: boolean }>> {
  try {
    const org = (await getSeoSettings()).global.organization;
    const out: Array<{ href: string; label: string; external: boolean }> = [];
    if (org.email) out.push({ href: `mailto:${org.email}`, label: org.email, external: false });
    if (org.phone) out.push({ href: `tel:${org.phone.replace(/[^\d+]/g, "")}`, label: formatPhoneDisplay(org.phone) || org.phone, external: false });
    for (const url of org.sameAs.slice(0, 6)) {
      if (!isExternalHref(url) || !url.toLowerCase().startsWith("https://")) continue;
      let host = "";
      try {
        host = new URL(url).hostname.replace(/^www\./, "");
      } catch {
        continue;
      }
      out.push({ href: url, label: SOCIAL_NAMES[host] ?? host, external: true });
    }
    return out;
  } catch {
    return [];
  }
}

function FootLinks({ links }: { links: readonly { id: string; label: string; href: string; external?: boolean }[] }) {
  return (
    <ul>
      {links.map((l) => (
        <li key={l.id}>
          {l.external ? (
            <a href={l.href} target="_blank" rel="noopener noreferrer">
              {l.label}
              <span className="sr-only"> (yeni sekmede açılır)</span>
            </a>
          ) : l.href.startsWith("mailto:") || l.href.startsWith("tel:") ? (
            <a href={l.href}>{l.label}</a>
          ) : (
            <Link prefetch={false} href={l.href}>{l.label}</Link>
          )}
        </li>
      ))}
    </ul>
  );
}
