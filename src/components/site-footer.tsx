import Link from "next/link";
import { Brand } from "@/components/brand/brand";
import { ArrowRight, FileSignature, Scale, ShieldCheck } from "lucide-react";
import { getPublicPlanDefinitions } from "@/lib/billing/plan-definitions";
import { now, trParts } from "@/lib/clock";
import { toPublicMenu } from "@/lib/site-menu/public";
import { getLiveSiteMenu } from "@/lib/site-menu/store";

/**
 * Alt bilgi sütunları admin'den (Site menüsü > Alt bilgi) yönetilir; yayın yoksa varsayılan içerik kullanılır
 * (src/lib/site-menu/defaults.ts). Sunucu bileşeni: istemciye JS göndermez. `autoPlans` sütununa (varsayılan: "Paketler")
 * paket bağlantıları etkin plan tanımlarından (fiyat okuyucu) eklenir.
 */
export async function SiteFooter() {
  const menuColumns = toPublicMenu(await getLiveSiteMenu(), now()).footer;
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
            <Link href="/" className="mk-logo" style={{ color: "#fff" }} aria-label="EmlakSoft ana sayfa">
              <Brand variant="horizontal" tone="dark" height={36} alt="" />
            </Link>
            <p style={{ margin: "1rem 0 0", maxWidth: "18rem", fontSize: "0.9375rem", lineHeight: 1.6 }}>
              Emlak ofisleri için müşteri, portföy, anlaşma ve komisyon akışını tek panelde toplayan abonelikli yazılım.
            </p>
            <ul className="mk-foot-badges" aria-label="Güven başlıkları">
              <li><ShieldCheck size={15} aria-hidden="true" />Frankfurt veri bölgesi</li>
              <li><Scale size={15} aria-hidden="true" />KVKK süreç araçları</li>
              <li><FileSignature size={15} aria-hidden="true" />SMS onaylı imza</li>
            </ul>
            <Link href="/kayit" className="mk-btn mk-btn-light" style={{ marginTop: "1.25rem", minHeight: "2.75rem", padding: "0.5rem 1rem", fontSize: "0.9375rem" }}>
              Ücretsiz dene <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>
          {columns.map((col) => (
            <nav key={col.id} aria-label={col.title}>
              <h2>{col.title}</h2>
              <ul>
                {col.links.map((l) => (
                  <li key={l.id}>
                    {l.external ? (
                      <a href={l.href} target="_blank" rel="noopener noreferrer">
                        {l.label}
                        <span className="sr-only"> (yeni sekmede açılır)</span>
                      </a>
                    ) : l.href.startsWith("mailto:") || l.href.startsWith("tel:") ? (
                      <a href={l.href}>{l.label}</a>
                    ) : (
                      <Link href={l.href}>{l.label}</Link>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="mk-foot-bottom">
          <p style={{ margin: 0 }}>© {trParts().year} EmlakSoft. Tüm hakları saklıdır.</p>
          <p style={{ margin: 0 }}>Ekran görüntüleri ve sayılar örnek veridir. Anılan portal adları yalnız takip içindir; resmi ortaklık iddiası yoktur.</p>
        </div>
      </div>
      <div className="mk-sticky-cta">
        <Link href="/kayit" className="mk-btn mk-btn-grad">Ücretsiz dene</Link>
      </div>
    </footer>
  );
}
