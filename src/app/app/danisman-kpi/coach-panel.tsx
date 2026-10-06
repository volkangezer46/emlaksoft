import Link from "next/link";
import { AlertTriangle, ArrowUpRight, Sparkles, ThumbsUp, TrendingUp } from "lucide-react";
import type { CoachAction } from "@/lib/advisor-coach";

/** Koç önerisi + ilgili ekran bağlantısı (sayfa tarafında eşlenir). */
export type CoachActionWithLink = CoachAction & { href?: string; hrefLabel?: string };

const STIL: Record<CoachAction["kind"], { cls: string; icon: typeof AlertTriangle; etiket: string }> = {
  urgent: {
    cls: "border-[color:var(--viz-neg)]/35 bg-[color-mix(in_srgb,var(--viz-neg)_6%,transparent)]",
    icon: AlertTriangle,
    etiket: "Acil",
  },
  improve: {
    cls: "border-[color:var(--viz-5)]/35 bg-[color-mix(in_srgb,var(--viz-5)_7%,transparent)]",
    icon: TrendingUp,
    etiket: "Geliştir",
  },
  praise: {
    cls: "border-[color:var(--viz-pos)]/35 bg-[color-mix(in_srgb,var(--viz-pos)_6%,transparent)]",
    icon: ThumbsUp,
    etiket: "İyi gidiyor",
  },
};

/**
 * Danışman koçu paneli (X3).
 *
 * NEDEN VAR: Bu sayfa doğru sayıları gösteriyordu — müşteri, çağrı, randevu,
 * teklif, anlaşma, ciro. Ama bir tabloya bakıp "bu hafta ne yapmalıyım"
 * sorusunu cevaplamak danışmanın işi olarak kalıyordu. Panel o mesafeyi
 * kapatıyor.
 *
 * NEDEN TEK KİŞİ İÇİN: Koç kişisel bir araç. Tüm ekip için ayrı ayrı üretmek
 * hem N+1 sorgu demek hem de kimsenin okumadığı bir liste. Panel oturum açan
 * kullanıcının kendi verisiyle çalışıyor.
 */
export function CoachPanel({ actions, adSoyad }: { actions: CoachActionWithLink[]; adSoyad: string | null }) {
  if (actions.length === 0) return null;

  return (
    <section className="surface-card rounded-[var(--radius-panel)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold text-accent-text">
            <Sparkles className="h-4 w-4" /> Kişisel koç
          </p>
          <h2 className="mt-1 font-display font-bold text-text">
            {adSoyad ? `${adSoyad} · bu hafta` : "Bu hafta"}
          </h2>
        </div>
        <span className="rounded-full bg-canvas px-2.5 py-1 text-xs text-text-muted">
          en fazla 4 madde
        </span>
      </div>

      <ul className="mt-4 space-y-2">
        {actions.map((a) => {
          const s = STIL[a.kind];
          const Ikon = s.icon;
          return (
            <li key={a.title} className={`flex gap-3 rounded-[var(--radius-card)] border px-4 py-3 ${s.cls}`}>
              <span className="mt-0.5 shrink-0">
                <Ikon className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-text">{a.title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-text-muted">{a.detail}</p>
                {a.href ? (
                  <Link
                    href={a.href}
                    className="focus-ring mt-1.5 inline-flex items-center gap-1 rounded-[var(--radius-control)] text-xs font-semibold text-accent-text hover:underline"
                  >
                    {a.hrefLabel ?? "İlgili ekrana git"}
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </Link>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      <p className="mt-3 text-xs leading-relaxed text-text-faint">
        Öneriler kural tabanlıdır; eşikler emlak operasyonunda yaygın kabul gören oranlardan seçildi,
        geçmiş veriden öğrenilmedi. Kendi bildiğiniz bağlam her zaman önce gelir.
      </p>
    </section>
  );
}
