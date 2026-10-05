import Link from "next/link";
import { BarChart3, Headphones, Settings2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "sonuclar", href: "/app/anketler", label: "Sonuçlar", icon: BarChart3 },
  { key: "kuyruk", href: "/app/anketler/kuyruk", label: "Anketör kuyruğu", icon: Headphones },
  { key: "ayarlar", href: "/app/anketler/ayarlar", label: "Tetikleyiciler ve şablonlar", icon: Settings2 },
] as const;

/** Anketler modülü sekmeleri (sunucu bileşeni; üç sayfa ortak kullanır). */
export function SurveyNav({ current }: { current: (typeof TABS)[number]["key"] }) {
  return (
    <nav aria-label="Anketler bölümleri" className="mb-5 flex flex-wrap gap-1 rounded-[var(--radius-card)] border border-line bg-surface p-1">
      {TABS.map((t) => {
        const active = t.key === current;
        return (
          <Link
            key={t.key}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "focus-ring inline-flex min-h-9 items-center gap-2 rounded-[var(--radius-control)] px-3 text-sm font-semibold transition",
              active ? "bg-brand-600 text-white" : "text-text-muted hover:bg-surface-hover hover:text-ink-950",
            )}
          >
            <t.icon className="h-4 w-4" aria-hidden="true" />
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Tablolar yokken (migration uygulanmadı) tüm sayfalarda gösterilen açık uyarı. */
export function SurveyNotReady() {
  return (
    <Alert tone="warning" title="Anket modülü bu ortamda henüz etkin değil">
      Anketör kuyruğu için gereken veritabanı tabloları bu ortamda oluşturulmamış. Veritabanı güncellemesi uygulanana kadar
      bu bölüm kullanılamaz; mevcut müşteri memnuniyet anketi (Raporlar &gt; Memnuniyet) ve bağlı anket linkleri aynen çalışmaya devam eder.
    </Alert>
  );
}
