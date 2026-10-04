import { CalendarCheck, FileSignature, LayoutGrid, Scale, Workflow } from "lucide-react";
import { CountUp } from "@/components/ui/count-up";
import { NAV_SECTIONS } from "@/lib/nav-config";

/**
 * Sahte rakam yerine doğrulanabilir gerçekler. Kaynaklar: getEffectiveTrialDays (deneme günü, sunucuda okunur),
 * vercel.json (27 cron, `npm run check:cron`), nav-config (iş başlığı sayısı), SMS onaylı dijital imza.
 * Sunucu çıktısı SONUÇ değerini basar (JS kapalıyken de doğru); sayılar ilk görünümde bir kez yukarı sayar (CountUp, ek paket yok).
 */
const CRON_COUNT = 27;

export function TrustStrip({ trialDays }: { trialDays?: number }) {
  const facts = [
    ...(trialDays ? [{ icon: CalendarCheck, value: `${trialDays} gün`, label: "ücretsiz deneme, kartsız", href: "#fiyat" }] : []),
    { icon: Workflow, value: String(CRON_COUNT), label: "otomatik görev", href: "#nasil" },
    { icon: LayoutGrid, value: String(NAV_SECTIONS.length), label: "iş başlığı, tek menü", href: "#tur" },
    { icon: FileSignature, value: "SMS", label: "onaylı dijital imza", href: "#ozellikler" },
    { icon: Scale, value: "KVKK", label: "süreç araçları", href: "#guvenlik" },
  ];
  return (
    <section aria-label="Doğrulanabilir gerçekler" className="mk-wrap">
      <ul className="mk-trust mk-stagger" data-count={facts.length}>
        {facts.map((f, i) => (
          <li key={f.label} style={{ "--i": i } as React.CSSProperties}>
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
