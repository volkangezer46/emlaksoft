import { CalendarCheck, FileSignature, LayoutGrid, Scale, Workflow } from "lucide-react";
import { NAV_SECTIONS } from "@/lib/nav-config";

/**
 * Sahte rakam yerine doğrulanabilir gerçekler. Kaynaklar: kayıt akışı (14 gün, kartsız), vercel.json (27 cron),
 * nav-config (iş başlığı sayısı), plans.ts (SMS onaylı dijital imza Ofis ve üstü). Statik metin: JS kapalıyken de doğru.
 */
const CRON_COUNT = 27;

const FACTS = [
  { icon: CalendarCheck, value: "14 gün", label: "ücretsiz deneme, kartsız", href: "#fiyat" },
  { icon: Workflow, value: String(CRON_COUNT), label: "otomatik görev", href: "#nasil" },
  { icon: LayoutGrid, value: String(NAV_SECTIONS.length), label: "iş başlığı, tek menü", href: "#tur" },
  { icon: FileSignature, value: "SMS", label: "onaylı dijital imza", href: "#ozellikler" },
  { icon: Scale, value: "KVKK", label: "süreç araçları", href: "#guvenlik" },
];

export function TrustStrip() {
  return (
    <section aria-label="Doğrulanabilir gerçekler" className="mk-wrap">
      <ul className="mk-trust">
        {FACTS.map((f) => (
          <li key={f.label}>
            <a href={f.href}>
              <f.icon size={22} aria-hidden="true" />
              <span><b>{f.value}</b><small>{f.label}</small></span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
