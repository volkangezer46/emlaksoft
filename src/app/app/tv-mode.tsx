"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/** TV modu canlı saat — saniyeli, tabular; SSR'da boş, hydrate'te dolar. */
export function TvClock() {
  const [now, setNow] = useState("");

  useEffect(() => {
    const fmt = new Intl.DateTimeFormat("tr-TR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const tick = () => setNow(fmt.format(new Date()));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <span className="font-display text-2xl font-extrabold tabular-nums text-white">
      {now || "--:--:--"}
    </span>
  );
}

/** TV modu: aralıklı soft refresh — sunucu verisi arka planda tazelenir. */
export function TvAutoRefresh({ intervalMs = 60_000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const t = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(t);
  }, [router, intervalMs]);

  return null;
}
