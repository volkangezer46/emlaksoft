"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, BookmarkPlus } from "lucide-react";
import { saveMatchAndNotify } from "@/app/actions/matching";
import { useToast } from "@/components/app/toast-provider";

export function SaveMatchButton({ demandId, propertyId }: { demandId: string; propertyId: string }) {
  const [pending, startTransition] = useTransition();
  const { push } = useToast();
  const router = useRouter();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          const fd = new FormData();
          fd.set("demand_id", demandId);
          fd.set("property_id", propertyId);
          const res = await saveMatchAndNotify(fd);
          if (res.error) push(res.error, "err");
          else {
            push(`Eşleşme kaydedildi · skor ${res.score ?? ""}`, "ok");
            router.refresh();
          }
        });
      }}
      className="inline-flex items-center gap-1 rounded-[8px] bg-ink-950 px-2.5 py-1.5 text-[11px] font-bold text-white disabled:opacity-50"
    >
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BookmarkPlus className="h-3.5 w-3.5" />}
      Kaydet & bildir
    </button>
  );
}
