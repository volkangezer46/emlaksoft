import { stopImpersonation } from "@/app/actions/platform";
import { Eye } from "lucide-react";

export function OpsImpersonationBanner({ tenantName }: { tenantName: string }) {
  return (
    <div className="relative z-40 flex flex-wrap items-center justify-between gap-3 border-b border-amber-400/40 bg-[linear-gradient(90deg,#3b2a08,#1a1205)] px-4 py-2.5 text-amber-100 md:px-6">
      <p className="flex items-center gap-2 text-xs font-semibold">
        <Eye className="h-3.5 w-3.5 text-amber-300" />
        Ops görünümü · <span className="font-bold text-white">{tenantName}</span>
        <span className="hidden text-amber-200/70 sm:inline">— yazmalar audit’e düşer · bitirmeden çıkmayın</span>
      </p>
      <form action={stopImpersonation}>
        <button
          type="submit"
          className="rounded-[8px] bg-amber-300 px-3 py-1.5 text-[11px] font-bold text-ink-950 transition hover:bg-amber-200"
        >
          Önizlemeyi bitir
        </button>
      </form>
    </div>
  );
}
