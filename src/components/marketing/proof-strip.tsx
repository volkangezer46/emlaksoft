import { NAV_SECTIONS } from "@/lib/nav-config";

/**
 * Sahte logo yerine doğrulanabilir gerçekler. Kaynaklar: kayıt akışı (14 gün, kartsız), vercel.json (27 cron),
 * nav-config (iş başlığı sayısı), plans.ts (SMS onaylı dijital imza Ofis ve üstü).
 * Değerler statik metindir: JS kapalıyken de doğru görünür (sayaç animasyonu bilerek yok).
 */
const CRON_COUNT = 27;

const FACTS = [
  { value: "14 gün", label: "ücretsiz deneme", more: "Fiyatlara git", href: "#fiyat" },
  { value: String(CRON_COUNT), label: "otomatik görev", more: "Nasıl çalışır", href: "#nasil" },
  { value: String(NAV_SECTIONS.length), label: "iş başlığı, tek menü", more: "Ürün turu", href: "#tur" },
  { value: "SMS", label: "onaylı dijital imza", more: "Özelliklere git", href: "#ozellikler" },
];

export function ProofStrip() {
  return (
    <section aria-label="Doğrulanabilir gerçekler" className="mk-wrap" style={{ paddingTop: "clamp(1rem, 4vw, 3rem)" }}>
      <ul className="mk-proof mk-reveal">
        {FACTS.map((f) => (
          <li key={f.label}>
            <a href={f.href}>
              <b>{f.value}</b>
              <span>{f.label}</span>
              <em>{f.more} →</em>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
