import { AlertTriangle, Sparkles, ThumbsUp, TrendingUp } from "lucide-react";
import type { CoachAction } from "@/lib/advisor-coach";

const STIL: Record<CoachAction["kind"], { cls: string; icon: typeof AlertTriangle; etiket: string }> = {
  urgent: {
    cls: "border-danger-500/35 bg-danger-500/[0.06]",
    icon: AlertTriangle,
    etiket: "Acil",
  },
  improve: {
    cls: "border-amber-400/35 bg-amber-400/[0.07]",
    icon: TrendingUp,
    etiket: "Geliştir",
  },
  praise: {
    cls: "border-mint-500/35 bg-mint-500/[0.06]",
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
export function CoachPanel({ actions, adSoyad }: { actions: CoachAction[]; adSoyad: string | null }) {
  if (actions.length === 0) return null;

  return (
    <section className="surface-card rounded-[var(--radius-panel)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold text-brand-600">
            <Sparkles className="h-4 w-4" /> Kişisel koç
          </p>
          <h2 className="mt-1 font-display font-bold text-ink-950">
            {adSoyad ? `${adSoyad} · bu hafta` : "Bu hafta"}
          </h2>
        </div>
        <span className="rounded-full bg-canvas px-2.5 py-1 text-[11px] text-text-muted">
          en fazla 4 madde
        </span>
      </div>

      <ul className="mt-4 space-y-2">
        {actions.map((a) => {
          const s = STIL[a.kind];
          const Ikon = s.icon;
          return (
            <li key={a.title} className={`flex gap-3 rounded-[14px] border px-4 py-3 ${s.cls}`}>
              <span className="mt-0.5 shrink-0">
                <Ikon className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink-950">{a.title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-text-muted">{a.detail}</p>
              </div>
            </li>
          );
        })}
      </ul>

      <p className="mt-3 text-[11px] leading-relaxed text-text-faint">
        Öneriler kural tabanlıdır; eşikler emlak operasyonunda yaygın kabul gören oranlardan seçildi,
        geçmiş veriden öğrenilmedi. Kendi bildiğiniz bağlam her zaman önce gelir.
      </p>
    </section>
  );
}
