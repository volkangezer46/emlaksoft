import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { REAL_USE_HREF, demoStripText } from "@/lib/sample-data/real-use";
import { trialLabel, trialUrgency } from "@/lib/sample-data/trial";

/**
 * Kabuk şeridi (sunucu bileşeni, istemci JS yok): ofiste örnek veri varsa ve/veya deneme sürüyorsa /app'in her
 * sayfasında, üst barın hemen üstünde İNCE ve KAPATILAMAZ tek satır:
 *   "Demo verisiyle çalışıyorsun · 12 gün deneme kaldı · Gerçek kullanıma geç"
 * Mobilde iki satıra sarar. Koyu temada `tone-warning` token'ları ile uyumlu. Örnek veri yoksa ve deneme değilse
 * HİÇ çizilmez. Eylem: owner/gm için "Gerçek kullanıma geç" (sayfa), diğer roller için yalnız bilgi; denemede
 * "Paket seç" aboneliğe gider. Ana ekrandaki eski kapatılabilir bant kaldırıldı (tek şerit, tek kaynak).
 */
export function DemoTrialStrip({
  sampleActive,
  trialDaysLeft,
  canSwitch,
}: {
  sampleActive: boolean;
  /** Deneme ofisinde kalan gün; deneme değilse null. */
  trialDaysLeft: number | null;
  /** Gerçek kullanıma geçiş bağlantısı gösterilsin mi (owner/gm, destek oturumu değil). */
  canSwitch: boolean;
}) {
  const text = demoStripText({ sampleActive, trialText: trialLabel(trialDaysLeft) });
  if (!text) return null;
  const urgency = trialUrgency(trialDaysLeft);
  const tone = urgency === "last" ? "tone-danger" : "tone-warning";
  return (
    <aside
      aria-label="Demo ve deneme durumu"
      data-tour="demo-seridi"
      className={`${tone} flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-line px-3 py-1.5 text-xs font-semibold`}
    >
      <span className="inline-flex items-center gap-1.5">
        <Sparkles className="h-3.5 w-3.5" aria-hidden />
        {text}
      </span>
      {sampleActive && canSwitch ? (
        <Link href={REAL_USE_HREF} className="focus-ring inline-flex items-center gap-1 rounded-[var(--radius-control)] underline underline-offset-2 hover:no-underline">
          Gerçek kullanıma geç <ArrowRight className="h-3 w-3" aria-hidden />
        </Link>
      ) : null}
      {trialDaysLeft != null ? (
        <Link href="/app/abonelik" className="focus-ring inline-flex items-center gap-1 rounded-[var(--radius-control)] underline underline-offset-2 hover:no-underline">
          {trialDaysLeft <= 0 ? "Paket seç" : "Paketleri gör"}
        </Link>
      ) : null}
    </aside>
  );
}
