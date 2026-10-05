import { Gift } from "lucide-react";
import { formatTry } from "@/lib/format";

/**
 * Davet bağlantısıyla gelen ziyaretçiye "X sizi davet etti" + avantaj. Veri sunucuda `growth_invite_preview`
 * (anon; program açık ve kod aktifse) ile gelir; tutar yalnız ayar satırından. Kişisel veri yok (ofis adı, davetçinin kendi paylaştığı bağlantıdır).
 */
export type InviteBannerData = { officeName: string; welcomeCreditTry: number };

export function InviteBanner({ invite }: { invite: InviteBannerData | null }) {
  if (!invite) return null;
  return (
    <aside
      role="note"
      className="mt-5 flex items-start gap-3 rounded-[var(--radius-card)] border border-mint-500/30 bg-mint-500/10 p-3 text-sm"
    >
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-mint-500/20 text-mint-700">
        <Gift className="h-4 w-4" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="font-semibold text-ink-950">{invite.officeName} sizi EmlakSoft&apos;a davet etti</p>
        {invite.welcomeCreditTry > 0 ? (
          <p className="mt-0.5 text-xs text-text-muted">
            İlk ödemenizi yaptığınızda hesabınıza {formatTry(invite.welcomeCreditTry)} hoş geldin kredisi yüklenir; sonraki faturanızdan düşer (fatura payı sınırı geçerlidir).
          </p>
        ) : (
          <p className="mt-0.5 text-xs text-text-muted">Kaydı tamamladığınızda deneme süreniz başlar.</p>
        )}
      </div>
    </aside>
  );
}
