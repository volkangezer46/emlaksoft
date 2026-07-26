"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { resolveErrorLog } from "@/app/actions/error-logs";

/** "Çözüldü" işareti — kayıt silinmez, listeden çıkar ve arşivde kalır. */
export function ResolveErrorButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await resolveErrorLog(id);
          router.refresh();
        })
      }
      className="focus-ring press inline-flex shrink-0 items-center gap-1.5 rounded-[9px] border border-line px-3 py-1.5 text-xs font-semibold text-text-muted transition hover:border-mint-500/40 hover:text-mint-600 disabled:opacity-60"
    >
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
      Çözüldü
    </button>
  );
}
