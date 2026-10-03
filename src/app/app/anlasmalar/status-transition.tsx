"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Workflow } from "lucide-react";
import { updateDealStage, type DealStage } from "@/app/actions/deals";
import { useToast } from "@/components/app/toast-provider";
import { defaultStageLabels, type StageLabels } from "@/lib/deal-stage-labels";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type FlowItem = { from: DealStage; to: DealStage; label: (n: (s: DealStage) => string) => string; tone: string };

// Düğme metinleri ofisin aşama adlarından türer (aşama anahtarları sabit).
const FLOW: FlowItem[] = [
  { from: "new", to: "qualified", label: (n) => `${n("qualified")} yap`, tone: "bg-brand-600" },
  { from: "qualified", to: "negotiation", label: (n) => `${n("negotiation")} aşamasına al`, tone: "bg-amber-500" },
  { from: "negotiation", to: "won", label: (n) => `${n("won")} + komisyon`, tone: "bg-mint-600" },
  { from: "negotiation", to: "lost", label: (n) => n("lost"), tone: "bg-danger-500" },
  { from: "qualified", to: "lost", label: (n) => n("lost"), tone: "bg-danger-500" },
  { from: "new", to: "lost", label: (n) => n("lost"), tone: "bg-danger-500" },
  // Geri alma (C.6) — yanlış işaretlenen kazanma/kayıp müzakereye döndürülür.
  // Kazanmayı geri alınca tahsil edilmemiş otomatik komisyon silinir ve portföy
  // durumu 'active'e döner (bkz. actions/deals.ts updateDealStage). Tahsil edilmiş
  // komisyon varsa action engeller.
  { from: "won", to: "negotiation", label: (n) => `${n("won")} durumunu geri al`, tone: "bg-amber-500" },
  { from: "lost", to: "negotiation", label: () => "Yeniden aç", tone: "bg-amber-500" },
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
  stageLabels = defaultStageLabels(),
  onLossRequest,
}: {
  dealId: string;
  stage: string;
  /** Ofisin görünen aşama adları. */
  stageLabels?: StageLabels;
  /** Kayıp geçişi neden seçimi gerektirir: verilirse diyalog çağırana aittir (tetikleyen düğme odağı için verilir). */
  onLossRequest?: (trigger: HTMLElement | null) => void;
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

  const nameOf = (s: DealStage) => stageLabels[s].label;

  function run(to: DealStage) {
    // Kayıp: neden seçilmeden geçiş yapılmaz (eski sabit "Durum geçişi" metni kaldırıldı).
    if (to === "lost") {
      if (!onLossRequest) return;
      setOpen(false);
      onLossRequest(document.activeElement instanceof HTMLElement ? document.activeElement : null);
      return;
    }
    // Kutlama sihirbazı optimistic açılır — server onayı beklenmez
    if (to === "won") onWonStart?.();
    startTransition(async () => {
      const fd = new FormData();
      fd.set("deal_id", dealId);
      fd.set("stage", to);
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
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={pending}
          className="focus-ring inline-flex items-center gap-1 rounded-[var(--radius-control)] border border-line bg-surface px-2.5 py-1.5 text-xs font-bold text-ink-950 hover:border-brand-300 disabled:opacity-60"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Workflow className="h-3.5 w-3.5 text-brand-600" />}
          Geçiş
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-[200px] p-1.5" align="end">
        <DropdownMenuLabel className="border-b border-line px-2 py-2 tracking-[0.08em]">
          Aşama geçişi
        </DropdownMenuLabel>
        {options.map((option) => (
          <DropdownMenuItem
            key={option.to}
            disabled={pending}
            danger={option.to === "lost"}
            onSelect={() => run(option.to)}
            className="text-xs font-semibold"
          >
            <span className={`h-2 w-2 rounded-full ${option.tone}`} aria-hidden="true" />
            {option.label(nameOf)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
