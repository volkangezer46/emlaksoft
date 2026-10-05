import Link from "next/link";

const TABS = [
  { key: "motor", href: "/app/degerleme", label: "Değerleme motoru" },
  { key: "parsel", href: "/app/degerleme/parsel", label: "Ada/Parsel değerleme (EmlakFiyati)" },
] as const;

/** Değerleme sayfası sekmeleri (menüye yeni öğe EKLEMEZ: menü sözleşmesi korunur). */
export function DegerlemeTabs({ active, parselReady = true }: { active: "motor" | "parsel"; parselReady?: boolean }) {
  // Ada/Parsel hazır değilken sekme gizlenir (ofis kullanıcısına çıkmaz sayfa gösterilmez).
  const tabs = TABS.filter((t) => t.key !== "parsel" || parselReady);
  if (tabs.length < 2) return null;
  return (
    <nav aria-label="Değerleme bölümleri" className="flex flex-wrap gap-2">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === active ? "page" : undefined}
          className={`focus-ring press rounded-full border px-4 py-2 text-sm font-semibold transition ${
            t.key === active
              ? "border-brand-600 bg-brand-600 text-white"
              : "border-line bg-surface text-ink-950 hover:border-brand-300"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
