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
import { closingTabHref } from "./[id]/kapanis-model";

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

/**
 * Kart üzerindeki "Geçiş" menüsü: sürükle-bırakın klavye/alternatif yolu.
 * Kazanıldı ve Kaybedildi popup AÇMAZ; anlaşma detayındaki Kapanış sekmesine (sihirbaz) götürür,
 * aşama orada onaylanınca değişir. Diğer geçişler doğrudan `updateDealStage` ile yapılır.
 */
export function StatusTransitionBar({
  dealId,
  stage,
  stageLabels = defaultStageLabels(),
}: {
  dealId: string;
  stage: string;
  /** Ofisin görünen aşama adları. */
  stageLabels?: StageLabels;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const options = FLOW.filter((f) => f.from === stage);

  if (options.length === 0) return null;

  const nameOf = (s: DealStage) => stageLabels[s].label;

  function run(to: DealStage) {
    if (to === "won" || to === "lost") {
      // Kapanış: tutar/paylar ya da kayıp nedeni sihirbazda sorulur; burada aşama değişmez.
      setOpen(false);
      startTransition(() => router.push(closingTabHref(dealId, to)));
      return;
    }
    startTransition(async () => {
      const fd = new FormData();
      fd.set("deal_id", dealId);
      fd.set("stage", to);
      const res = await updateDealStage(fd);
      if (res.error) {
        push(res.error, "err");
      } else {
        push("Aşama güncellendi", "ok");
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
