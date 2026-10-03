"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { SKIP_COOKIE, serializeSkipCookie } from "./siradaki";

/**
 * "Bugün için geç": bu eylemi bugünlük atlar (çerez `GÜN|anahtarlar`, gece yarısı sonrası geçersiz)
 * ve sıradaki eyleme geçer. Sunucuya yazmaz; çerez yalnız bu tarayıcıda tercih tutar.
 */
export function SiradakiGec({ actionKey, dismissed, todayKey }: { actionKey: string; dismissed: string[]; todayKey: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        const value = encodeURIComponent(serializeSkipCookie(todayKey, [...dismissed, actionKey]));
        document.cookie = `${SKIP_COOKIE}=${value}; path=/app; max-age=86400; samesite=lax`;
        start(() => router.refresh());
      }}
      className="focus-ring press inline-flex min-h-10 items-center rounded-[var(--radius-control)] px-3 text-sm font-semibold text-text-muted transition hover:bg-canvas hover:text-ink-950 disabled:opacity-60"
    >
      Bugün için geç
    </button>
  );
}
