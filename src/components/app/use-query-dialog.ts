"use client";

import { useCallback, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Bir query parametresiyle açılan diyaloğu normal kontrollü Radix state'iyle
 * birleştirir. Diyalog kapanınca parametre history'den temizlenir; böylece
 * refresh sonrası kendiliğinden yeniden açılmaz.
 */
export function useQueryDialog(defaultOpen: boolean, parameter = "yeni") {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [open, setOpenState] = useState(defaultOpen);

  const setOpen = useCallback(
    (next: boolean) => {
      setOpenState(next);
      if (!next && searchParams.has(parameter)) {
        const params = new URLSearchParams(searchParams.toString());
        params.delete(parameter);
        const query = params.toString();
        router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
      }
    },
    [parameter, pathname, router, searchParams],
  );

  return [open, setOpen] as const;
}
