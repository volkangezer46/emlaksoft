"use client";

import { Button } from "@/components/ui/button";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { resolveErrorLog } from "@/app/actions/error-logs";

/** "Çözüldü" işareti — kayıt silinmez, listeden çıkar ve arşivde kalır. */
export function ResolveErrorButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <Button variant="outline" size="sm"
 type="button"
 disabled={pending}
 onClick={() =>
 start(async () => {
 await resolveErrorLog(id);
 router.refresh();
 })
 }
 className="shrink-0">
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
      Çözüldü
    </Button>
  );
}
