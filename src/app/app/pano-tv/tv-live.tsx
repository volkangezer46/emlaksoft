"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Maximize2, RefreshCw } from "lucide-react";

/**
 * TV panosu canlı katmanı: saat, otomatik yenileme (router.refresh) ve tam-ekran
 * düğmesi. Veri sunucuda çekilir; bu bileşen yalnız tazeleme/etkileşimi yönetir.
 */
export function TvLive({ intervalSec = 45 }: { intervalSec?: number }) {
  const router = useRouter();
  const [clock, setClock] = useState("");
  const [fs, setFs] = useState(false);

  useEffect(() => {
    const tick = () =>
      setClock(new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalSec * 1000);
    return () => clearInterval(id);
  }, [router, intervalSec]);

  useEffect(() => {
    const onFs = () => setFs(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      /* tarayıcı engelleyebilir — sessiz geç */
    }
  }

  return (
    <div className="flex items-center gap-3">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-sm font-semibold tabular-nums text-white/80">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-mint-400" /> {clock}
      </span>
      <span className="hidden items-center gap-1.5 text-xs text-white/40 sm:inline-flex">
        <RefreshCw className="h-3.5 w-3.5" /> {intervalSec}sn'de bir yenilenir
      </span>
      <button
        type="button"
        onClick={toggleFullscreen}
        className="focus-ring press inline-flex items-center gap-1.5 rounded-[10px] border border-white/15 bg-white/8 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-white/15"
      >
        <Maximize2 className="h-3.5 w-3.5" /> {fs ? "Çık" : "Tam ekran"}
      </button>
    </div>
  );
}
