import { BadgeCheck, CalendarCheck, FileSignature, LayoutGrid, Scale, Workflow, type LucideIcon } from "lucide-react";
import { CountUp } from "@/components/ui/count-up";
import { CRON_JOBS } from "@/lib/cron-jobs";
import { NAV_GROUPS } from "@/lib/nav-roles";
import { menuIconComponent } from "@/lib/site-menu/icon-registry";
import { defaultSiteContent } from "@/lib/site-content/defaults";
import type { TrustItem } from "@/lib/site-content/schema";
import { homeHref } from "./content-link";

/**
 * Sahte rakam yerine doğrulanabilir gerçekler. Kaynaklar: getEffectiveTrialDays (deneme günü, sunucuda okunur),
 * cron envanteri (CRON_JOBS.length = vercel.json, `npm run check:cron` doğrular), nav-roles (yan menü grup başlığı sayısı), SMS onaylı dijital imza.
 * DEĞERLER koddan gelir (içerik editöründe değiştirilemez, sahte sayaç yok); yalnız etiket/bağlantı/sıra/gizleme düzenlenir.
 * Yönetimden eklenen öğe (`c_...`) DEĞERSİZ çizilir: yalnız ikon + etiket (elle yazılan sayı yok).
 * Sunucu çıktısı SONUÇ değerini basar (JS kapalıyken de doğru); sayılar ilk görünümde bir kez yukarı sayar (CountUp, ek paket yok).
 */
// Sabit sayı yazılmaz: envanterden türetilir (eskiden 27 sabitti ve gerçek sayıyla uyuşmuyordu).
const CRON_COUNT = CRON_JOBS.length;

type Fact = { id: string; label: string; href: string; icon: LucideIcon; value: string | null };

export function TrustStrip({ trialDays, content = defaultSiteContent().trust }: { trialDays?: number; content?: readonly TrustItem[] }) {
  const base: Record<string, { icon: LucideIcon; value: string } | null> = {
    deneme: trialDays ? { icon: CalendarCheck, value: `${trialDays} gün` } : null,
    gorev: { icon: Workflow, value: String(CRON_COUNT) },
    menu: { icon: LayoutGrid, value: String(NAV_GROUPS.length) },
    imza: { icon: FileSignature, value: "SMS" },
    kvkk: { icon: Scale, value: "KVKK" },
  };
  // Bilinen kimlik: değer koddan (null = şu an değer yok, ör. deneme günü bilinmiyor -> öğe çizilmez). Bilinmeyen kimlik düşmez.
  const knownOf = (id: string) => (Object.hasOwn(base, id) ? base[id] : undefined);
  const facts: Fact[] = content
    .filter((c) => !c.hidden && knownOf(c.id) !== null)
    .map((c) => {
      const known = knownOf(c.id);
      const icon = (c.icon ? menuIconComponent(c.icon) : null) ?? known?.icon ?? BadgeCheck;
      return { id: c.id, label: c.label, href: homeHref(c.href), icon, value: known ? known.value : null };
    });
  return (
    <section aria-label="Doğrulanabilir gerçekler" className="mk-wrap">
      <ul className="mk-trust mk-stagger" data-count={facts.length}>
        {facts.map((f, i) => (
          <li key={f.id} style={{ "--i": i } as React.CSSProperties}>
            <a href={f.href}>
              <f.icon size={22} aria-hidden="true" />
              {f.value !== null ? <span><b><CountUp value={f.value} /></b><small>{f.label}</small></span> : <span><b>{f.label}</b></span>}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
