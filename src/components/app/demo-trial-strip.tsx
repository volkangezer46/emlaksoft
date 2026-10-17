import Link from "@/components/ui/smart-link";
import { ArrowRight, PlayCircle, Sparkles } from "lucide-react";
import { REAL_USE_HREF } from "@/lib/sample-data/real-use";
import { trialLabel, trialUrgency } from "@/lib/sample-data/trial";

/** Ofisin demo durumu: örnek verili ofis, genel demo ofisi (giriş sayfası kartları) ya da gerçek kullanım (null). */
export type DemoMode = "sample" | "public" | null;

export const DEMO_BANNER_TITLE = "Demo ofisindesiniz";
export const DEMO_BANNER_TEXT = "gördüğünüz kayıtlar örnektir";
export const DEMO_BANNER_MEMBER_NOTE = "Ofis yöneticiniz gerçek kullanıma geçtiğinde örnek kayıtlar silinir";
export const DEMO_TOUR_HREF = "/app?tur=1";

/** Kabuk kararı (SAF): örnek veri damgası ya da genel demo ofisi → demo modu. */
export function resolveDemoMode(input: { sampleSeededAt: string | null | undefined; isPublicDemo: boolean }): DemoMode {
  if (input.isPublicDemo) return "public";
  return input.sampleSeededAt ? "sample" : null;
}

/**
 * Kabuk şeridi (SUNUCU bileşeni, istemci JS yok; kabukla birlikte çizilir → sayfa sonradan aşağı kaymaz). Ofis demo
 * modundayken /app'in her sayfasında, üst çubuğun hemen üstünde, TÜM rollere:
 *   "Demo ofisindesiniz — gördüğünüz kayıtlar örnektir"
 * Sahip/genel müdür: "Gerçek kullanıma geç" (iki onaylı geçiş sayfası) + "Demo turu". Diğer roller: yöneticinin geçişte
 * örnekleri sileceği notu + "Demo turu". Genel demo ofisinde: "Kendi ofisini aç" + "Demo turu". Deneme süresi aynı şeritte.
 * Demo modu da deneme de yoksa HİÇ çizilmez. Mobilde satırlar sarar; dokunma hedefleri ≥ 32 px (şerit içi bağlantı).
 */
export function DemoTrialStrip({
  mode,
  trialDaysLeft,
  canSwitch,
}: {
  mode: DemoMode;
  /** Deneme ofisinde kalan gün; deneme değilse null. */
  trialDaysLeft: number | null;
  /** Gerçek kullanıma geçiş bağlantısı gösterilsin mi (owner/gm, destek oturumu değil). */
  canSwitch: boolean;
}) {
  const trialText = trialLabel(trialDaysLeft);
  if (!mode && !trialText) return null;
  const urgency = trialUrgency(trialDaysLeft);
  const chip =
    "focus-ring inline-flex min-h-8 items-center gap-1 rounded-full px-3 text-xs font-bold transition-colors";

  if (!mode) {
    // Yalnız deneme (gerçek kullanımda): eski ince uyarı şeridi.
    return (
      <aside
        aria-label="Deneme durumu"
        data-tour="demo-seridi"
        className={`${urgency === "last" ? "tone-danger" : "tone-warning"} flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-line px-3 py-1.5 text-xs font-semibold`}
      >
        <span>{trialText}</span>
        <Link href="/app/abonelik" className="focus-ring rounded-[var(--radius-control)] underline underline-offset-2 hover:no-underline">
          {trialDaysLeft != null && trialDaysLeft <= 0 ? "Paket seç" : "Paketleri gör"}
        </Link>
      </aside>
    );
  }

  return (
    <aside
      aria-label="Demo ofis bilgisi"
      data-tour="demo-seridi"
      data-demo-banner={mode}
      className="relative border-b border-brand-500/20 bg-[linear-gradient(90deg,color-mix(in_srgb,var(--brand-600)_12%,var(--surface)),color-mix(in_srgb,var(--brand-600)_4%,var(--surface))_70%)] text-ink-950"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-1.5 sm:px-6">
        <p className="flex min-w-0 flex-1 basis-[15rem] items-center gap-2 text-xs sm:text-sm">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-600 text-white shadow-[0_0_0_3px_color-mix(in_srgb,var(--brand-600)_18%,transparent)]">
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
          </span>
          <span className="min-w-0">
            <strong className="font-display font-bold">{DEMO_BANNER_TITLE}</strong>
            <span className="text-text-muted"> — {DEMO_BANNER_TEXT}</span>
            {mode === "sample" && !canSwitch ? <span className="hidden text-text-faint md:inline"> · {DEMO_BANNER_MEMBER_NOTE}</span> : null}
            {trialText ? (
              <span className={urgency === "none" ? "text-text-faint" : "font-semibold text-danger-600"}> · {trialText}</span>
            ) : null}
          </span>
        </p>
        <nav aria-label="Demo işlemleri" className="flex shrink-0 flex-wrap items-center gap-1.5">
          <Link href={DEMO_TOUR_HREF} className={`${chip} text-brand-700 hover:bg-brand-600/10`}>
            <PlayCircle className="h-3.5 w-3.5" aria-hidden /> Demo turu
          </Link>
          {mode === "sample" && canSwitch ? (
            <Link href={REAL_USE_HREF} className={`${chip} bg-brand-600 text-white shadow-sm hover:bg-brand-700`}>
              Gerçek kullanıma geç <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          ) : null}
          {mode === "public" ? (
            <Link href="/kayit" className={`${chip} bg-brand-600 text-white shadow-sm hover:bg-brand-700`}>
              Kendi ofisini aç <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          ) : null}
        </nav>
        {mode === "sample" && !canSwitch ? <p className="w-full text-xs text-text-faint md:hidden">{DEMO_BANNER_MEMBER_NOTE}</p> : null}
      </div>
    </aside>
  );
}
