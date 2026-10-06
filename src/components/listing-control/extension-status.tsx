"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, CircleHelp, PauseCircle } from "lucide-react";
import { BRIDGE_RESPONSE_SOURCE, bridgeAutorun, bridgeInstalled, bridgePaused, parseBridgeMessage } from "@/lib/listing-control/worker/bridge";

type State = { installed: boolean; autorun: boolean; paused: boolean; version: string | null };

function read(version: string | null): State {
  return { installed: bridgeInstalled(), autorun: bridgeAutorun(), paused: bridgePaused(), version };
}

/** Bu tarayıcıda eklenti kurulu mu / otomatik kontrol açık mı (belge kökü işaretleri + `ready` iletisi). */
export function ExtensionStatus() {
  const [state, setState] = useState<State>({ installed: false, autorun: false, paused: false, version: null });
  useEffect(() => {
    let version: string | null = null;
    const refresh = () => setState(read(version));
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      if ((event.data as { source?: string } | null)?.source !== BRIDGE_RESPONSE_SOURCE) return;
      const msg = parseBridgeMessage(event.data);
      if (msg?.type === "ready") {
        version = msg.version;
        refresh();
      }
    };
    window.addEventListener("message", onMessage);
    const first = window.setTimeout(refresh, 0);
    const timer = window.setInterval(refresh, 3_000);
    return () => {
      window.removeEventListener("message", onMessage);
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, []);

  if (!state.installed) {
    return (
      <p role="status" className="flex items-center gap-2 rounded-[var(--radius-control)] border border-line px-3 py-2 text-sm text-text">
        <CircleHelp aria-hidden="true" className="h-4 w-4 text-text-muted" /> Bu tarayıcıda eklenti bulunamadı. Aşağıdaki adımlarla kurun, sonra bu sayfayı yenileyin.
      </p>
    );
  }
  if (state.paused) {
    return (
      <p role="status" className="tone-warning flex items-center gap-2 rounded-[var(--radius-control)] px-3 py-2 text-sm">
        <PauseCircle aria-hidden="true" className="h-4 w-4" /> Eklenti kurulu ama duraklatılmış. Tarayıcı araç çubuğundaki eklenti simgesinden &quot;Sürdür&quot;e basın.
      </p>
    );
  }
  return (
    <p role="status" className="tone-success flex items-center gap-2 rounded-[var(--radius-control)] px-3 py-2 text-sm">
      <CheckCircle2 aria-hidden="true" className="h-4 w-4" /> Eklenti kurulu{state.version ? ` (sürüm ${state.version})` : ""}
      {state.autorun ? " · EmlakSoft açıkken ilanlarınız otomatik kontrol ediliyor." : "."}
    </p>
  );
}
