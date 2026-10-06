import { CalendarCheck, FileSignature, LayoutGrid, Scale, Workflow, type LucideIcon } from "lucide-react";
import { CountUp } from "@/components/ui/count-up";
import { CRON_JOBS } from "@/lib/cron-jobs";
import { NAV_SECTIONS } from "@/lib/nav-config";
import { defaultSiteContent } from "@/lib/site-content/defaults";
import type { TrustItem } from "@/lib/site-content/schema";
import { homeHref } from "./content-link";

/**
 * Sahte rakam yerine doğrulanabilir gerçekler. Kaynaklar: getEffectiveTrialDays (deneme günü, sunucuda okunur),
 * cron envanteri (CRON_JOBS.length = vercel.json, `npm run check:cron` doğrular), nav-config (iş başlığı sayısı), SMS onaylı dijital imza.
 * DEĞERLER koddan gelir (içerik editöründe değiştirilemez, sahte sayaç yok); yalnız etiket/bağlantı/sıra/gizleme düzenlenir.
 * Sunucu çıktısı SONUÇ değerini basar (JS kapalıyken de doğru); sayılar ilk görünümde bir kez yukarı sayar (CountUp, ek paket yok).
 */
// Sabit sayı yazılmaz: envanterden türetilir (eskiden 27 sabitti ve gerçek sayıyla uyuşmuyordu).
const CRON_COUNT = CRON_JOBS.length;

export function TrustStrip({ trialDays, content = defaultSiteContent().trust }: { trialDays?: number; content?: readonly TrustItem[] }) {
  const base: Record<string, { icon: LucideIcon; value: string } | null> = {
    deneme: trialDays ? { icon: CalendarCheck, value: `${trialDays} gün` } : null,
    gorev: { icon: Workflow, value: String(CRON_COUNT) },
    menu: { icon: LayoutGrid, value: String(NAV_SECTIONS.length) },
    imza: { icon: FileSignature, value: "SMS" },
    kvkk: { icon: Scale, value: "KVKK" },
  };
  const facts = content.filter((c) => !c.hidden && base[c.id]).map((c) => ({ id: c.id, label: c.label, href: homeHref(c.href), ...base[c.id]! }));
  return (
    <section aria-label="Doğrulanabilir gerçekler" className="mk-wrap">
      <ul className="mk-trust mk-stagger" data-count={facts.length}>
        {facts.map((f, i) => (
          <li key={f.id} style={{ "--i": i } as React.CSSProperties}>
            <a href={f.href}>
              <f.icon size={22} aria-hidden="true" />
              <span><b><CountUp value={f.value} /></b><small>{f.label}</small></span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
