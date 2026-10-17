"use client";

import { Suspense, useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { lazyPanel } from "@/lib/lazy-panel";
import { runWhenIdle } from "@/lib/idle";
import { recentKey } from "@/lib/ai/zeka/client";

const cap = (s: string) => s.charAt(0).toLocaleUpperCase("tr-TR") + s.slice(1);

/** Telefon genişliği (≤639 px): yer tutucu kısa kalır; uzun örnek listesi dar kutuda kelime ortasından kesilmez. */
const PHONE_MQ = "(max-width: 639.98px)";
function subscribePhone(cb: () => void) {
  const mq = window.matchMedia(PHONE_MQ);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
const isPhone = () => window.matchMedia(PHONE_MQ).matches;

/** Yanıt paneli AYRI parçadır: ilk odak / yazma / boşta iner (ana ekran ilk yük paketine girmez). */
const panel = lazyPanel(() => import("@/components/zeka/zeka-panel").then((m) => m.ZekaPanel));

/**
 * Kahramandaki "Ne yapmak istiyorsun?" komut çubuğu = EmlakSoft ZEKA girişi. Yazarken yerel zekadan canlı öneriler
 * (combobox + listbox), Enter ile gerçek yanıt (sayılar, kayıtlar, ön doldurulmuş form bağlantıları, nasıl yapılır).
 * Motor sunucudadır (`/api/zeka`; yönetim panelinde `/api/zeka/yonetim`); bu ada yalnız giriş kutusu + tembel panel
 * yükleyicisidir. Ctrl/⌘ K üst çubuktaki komut paletini açar (paletin "Zeka'ya sor" satırı aynı paneli açar).
 */
export function HeroArama({ chips, storageScope }: { chips: readonly string[]; storageScope?: string }) {
  const surface = usePathname()?.startsWith("/admin") ? "admin" : "app";
  const [q, setQ] = useState("");
  const [view, setView] = useState<"closed" | "suggest" | "answer">("closed");
  const [submitted, setSubmitted] = useState<{ q: string; nonce: number } | null>(null);
  const [Panel, setPanel] = useState<ReturnType<typeof panel.resolve> | null>(null);
  const [form, setForm] = useState<HTMLFormElement | null>(null);
  // Panel kapanınca odak kutuya döner; o odak paneli yeniden açmasın.
  const skipFocusOpen = useRef(false);
  const [input, setInput] = useState<HTMLInputElement | null>(null);
  const listboxId = `${useId().replace(/:/g, "")}-zeka`;
  // Sunucu ve ilk hidrasyon kısa metinle (telefon önce); masaüstünde hidrasyondan hemen sonra örnekli uzun metne geçer.
  const phone = useSyncExternalStore(subscribePhone, isPhone, () => true);
  const hint = chips.length > 0 ? `${chips.map((c, i) => (i === 0 ? cap(c) : c)).join(", ")}…` : "Müşteri, portföy, görev ya da soru yazın…";

  useEffect(() => runWhenIdle(panel.preload), []);
  const ensurePanel = useCallback(() => {
    setPanel((cur: ReturnType<typeof panel.resolve> | null) => cur ?? panel.resolve());
  }, []);
  const close = useCallback(() => {
    setView("closed");
    skipFocusOpen.current = true;
    input?.focus();
  }, [input]);
  const submit = useCallback(
    (text: string) => {
      const value = text.trim();
      if (value.length < 2) return;
      ensurePanel();
      setQ(value);
      setSubmitted((s) => ({ q: value, nonce: (s?.nonce ?? 0) + 1 }));
      setView("answer");
    },
    [ensurePanel],
  );

  return (
    <>
      <form
        ref={setForm}
        role="search"
        className="kh-cmd"
        onSubmit={(e) => {
          e.preventDefault();
          submit(q);
        }}
      >
        <Sparkles className="kh-cmd-ico h-5 w-5 shrink-0" aria-hidden="true" />
        <label className="sr-only" htmlFor="kh-cmd-input">
          Ne yapmak istiyorsun? Zeka&apos;ya sorun
        </label>
        <input
          id="kh-cmd-input"
          ref={setInput}
          className="kh-cmd-input"
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={false}
          aria-controls={listboxId}
          inputMode="search"
          autoComplete="off"
          enterKeyHint="go"
          maxLength={300}
          value={q}
          onFocus={() => {
            ensurePanel();
            if (skipFocusOpen.current) {
              skipFocusOpen.current = false;
              return;
            }
            if (view === "closed") setView("suggest");
          }}
          onChange={(e) => {
            setQ(e.target.value);
            ensurePanel();
            setView("suggest");
          }}
          placeholder={phone ? "Ne yapmak istiyorsun?" : `Ne yapmak istiyorsun? ${hint}`}
          data-zeka-input=""
        />
        <kbd className="kh-kbd" aria-hidden="true">
          Ctrl K
        </kbd>
        <Button type="submit" variant="gold" size="icon" className="kh-cmd-go" aria-label="Zeka'ya sor">
          <ArrowRight className="h-[18px] w-[18px]" aria-hidden="true" />
        </Button>
      </form>
      {Panel && view !== "closed" ? (
        <Suspense fallback={null}>
          <Panel
            surface={surface}
            query={q}
            view={view}
            submitted={submitted}
            anchor={form}
            input={input}
            listboxId={listboxId}
            recentsKey={recentKey(storageScope, surface)}
            onSubmit={submit}
            onClose={close}
          />
        </Suspense>
      ) : null}
    </>
  );
}
