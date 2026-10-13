"use client";

import { Suspense, useEffect, useState, type ComponentProps } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { runWhenIdle } from "@/lib/idle";
import { lazyPanel } from "@/lib/lazy-panel";

/**
 * "Yenilikler" (AD8) — hafif kabuk: üst çubukta rozetli düğme. Okunmamış sayı sunucudan gelir (office_broadcast_state).
 * Çekmece (Radix Dialog, girdi listesi, sunucu eylemi) ilk tıkta yüklenir (hover/odak ve sayfa boşalınca önceden
 * ısıtılır); yüklenince aynı düğmeyi devralır ve açık gelir, rozet tıkta ANINDA söner (`lazyPanel`, zil ile aynı desen).
 */
const panel = lazyPanel(() => import("./whats-new-panel").then((m) => m.WhatsNewPanel));

/** Düğme: kabukta ve çekmece parçasında (DialogTrigger asChild) aynı görünüm. */
export function WhatsNewButton({ unread, ...props }: { unread: number } & ComponentProps<"button">) {
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={unread > 0 ? `Yenilikler, ${unread} okunmamış` : "Yenilikler"}
      title="Yenilikler"
      className="relative h-9 w-9 rounded-full hover:bg-ink-950/5"
      {...props}
    >
      <Sparkles className="h-4 w-4" aria-hidden />
      {unread > 0 ? (
        <span className="numeric absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-brand-600 px-1 text-xs font-bold leading-4 text-white">
          {unread > 9 ? "9+" : unread}
        </span>
      ) : null}
    </Button>
  );
}

export function WhatsNew({ unread: initialUnread }: { unread: number }) {
  const [Panel, setPanel] = useState<ReturnType<typeof panel.resolve> | null>(null);
  const [unread, setUnread] = useState(initialUnread);

  // Sayfa boşalınca çekmece parçasını arka planda indir: ilk tık beklemesin.
  useEffect(() => runWhenIdle(panel.preload), []);

  if (!Panel) {
    return (
      <WhatsNewButton
        unread={unread}
        aria-haspopup="dialog"
        aria-expanded={false}
        data-state="closed"
        onPointerEnter={panel.preload}
        onFocus={panel.preload}
        onClick={() => {
          setUnread(0);
          setPanel(() => panel.resolve());
        }}
      />
    );
  }
  return (
    <Suspense fallback={<WhatsNewButton unread={unread} aria-haspopup="dialog" aria-expanded data-state="open" />}>
      <Panel unread={unread} setUnread={setUnread} />
    </Suspense>
  );
}
