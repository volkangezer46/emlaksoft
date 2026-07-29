"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Workflow } from "lucide-react";
import { updateDealStage, type DealStage } from "@/app/actions/deals";
import { useToast } from "@/components/app/toast-provider";

const FLOW: { from: DealStage; to: DealStage; label: string; tone: string }[] = [
  { from: "new", to: "qualified", label: "Nitelikli yap", tone: "bg-brand-600" },
  { from: "qualified", to: "negotiation", label: "Müzakereye al", tone: "bg-amber-500" },
  { from: "negotiation", to: "won", label: "Kazanıldı + komisyon", tone: "bg-mint-600" },
  { from: "negotiation", to: "lost", label: "Kaybedildi", tone: "bg-danger-500" },
  { from: "qualified", to: "lost", label: "Kaybedildi", tone: "bg-danger-500" },
  { from: "new", to: "lost", label: "Kaybedildi", tone: "bg-danger-500" },
  // Geri alma (C.6) — yanlış işaretlenen kazanma/kayıp müzakereye döndürülür.
  // Kazanmayı geri alınca tahsil edilmemiş otomatik komisyon silinir ve portföy
  // durumu 'active'e döner (bkz. actions/deals.ts updateDealStage). Tahsil edilmiş
  // komisyon varsa action engeller.
  { from: "won", to: "negotiation", label: "Kazanmayı geri al", tone: "bg-amber-500" },
  { from: "lost", to: "negotiation", label: "Yeniden aç", tone: "bg-amber-500" },
];

/** Tahta DnD'si de aynı kuralları izlesin diye tek kaynak: butonlarda hangi
 *  geçiş serbestse sürükle-bırakta da yalnız o serbesttir (won/lost'tan geri yok). */
export function isAllowedTransition(from: string, to: DealStage) {
  return FLOW.some((f) => f.from === from && f.to === to);
}

export function StatusTransitionBar({
  dealId,
  stage,
  onWonStart,
  onWonError,
}: {
  dealId: string;
  stage: string;
  /** Won geçişi başlarken (server onayı beklenmeden) — kutlama sihirbazını açar; verildiğinde won toast'ı atlanır. */
  onWonStart?: () => void;
  /** Won geçişi hata verirse — sihirbaz kapatılır (mevcut geri sarma korunur). */
  onWonError?: () => void;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const options = FLOW.filter((f) => f.from === stage);

  if (options.length === 0) return null;

  function run(to: DealStage) {
    // Kutlama sihirbazı optimistic açılır — server onayı beklenmez
    if (to === "won") onWonStart?.();
    startTransition(async () => {
      const fd = new FormData();
      fd.set("deal_id", dealId);
      fd.set("stage", to);
      if (to === "lost") fd.set("loss_reason", "Durum geçişi");
      const res = await updateDealStage(fd);
      if (res.error) {
        push(res.error, "err");
        if (to === "won") onWonError?.();
      } else {
        // Sihirbaz devralmışsa won toast'ı gösterilmez
        if (!(to === "won" && onWonStart)) {
          push(to === "won" ? "Kazanıldı · komisyon üretildi" : "Aşama güncellendi", "ok");
        }
        setOpen(false);
        router.refresh();
      }
    });
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded-[8px] border border-line bg-surface px-2.5 py-1.5 text-[11px] font-bold text-ink-950 hover:border-brand-300"
      >
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Workflow className="h-3.5 w-3.5 text-brand-600" />}
        Geçiş
      </button>
      {open ? (
        <>
          <button type="button" className="fixed inset-0 z-40" aria-label="Kapat" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-9 z-50 min-w-[200px] overflow-hidden rounded-[12px] border border-line bg-surface shadow-[var(--shadow-lg)]">
            <p className="border-b border-line px-3 py-2 text-[11px] font-bold uppercase tracking-[0.08em] text-text-faint">
              Aşama geçişi
            </p>
            {options.map((o) => (
              <button
                key={o.to}
                type="button"
                disabled={pending}
                onClick={() => run(o.to)}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs font-semibold text-ink-950 hover:bg-canvas disabled:opacity-50"
              >
                <span className={`h-2 w-2 rounded-full ${o.tone}`} />
                {o.label}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
