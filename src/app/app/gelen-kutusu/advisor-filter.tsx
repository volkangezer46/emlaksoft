"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, UserRound } from "lucide-react";
import { PersonSelect, type PersonOption } from "@/components/ui/person-select";
import { cn } from "@/lib/utils";

/**
 * Gelen kutusu danışman süzgeci (COM-01): ofis görünümünde konuşmaları müşterinin danışmanına göre süzer. URL kontratı
 * `?danisman=<id>` (sunucu RPC'si `p_assignee`); seçim temizlenince param silinir. "Bana atananlar" çipi ayrıca durur.
 * `baseQuery`: danışman ve sayfa dışındaki geçerli süzgeçler (sunucu üretir; seçim değişince sayfa 1'e dönülür).
 */
export function InboxAdvisorFilter({
  people,
  value,
  pathname,
  baseQuery,
  featuredIds,
}: {
  people: readonly PersonOption[];
  value: string;
  pathname: string;
  baseQuery: string;
  featuredIds?: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onChange(id: string) {
    const sp = new URLSearchParams(baseQuery);
    if (id) sp.set("danisman", id);
    else sp.delete("danisman");
    const qs = sp.toString();
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  return (
    <div className={cn("flex min-w-0 items-center gap-1.5", pending && "opacity-70")} aria-busy={pending}>
      {pending ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-brand-600" aria-hidden="true" />
      ) : (
        <UserRound className="h-4 w-4 shrink-0 text-brand-600" aria-hidden="true" />
      )}
      <PersonSelect
        people={people}
        featuredIds={featuredIds}
        value={value}
        onValueChange={onChange}
        emptyLabel="Tüm danışmanlar"
        aria-label="Danışmana göre süz"
        className="min-h-11 w-full min-w-[12rem] text-sm sm:min-h-9 sm:w-56"
      />
    </div>
  );
}
