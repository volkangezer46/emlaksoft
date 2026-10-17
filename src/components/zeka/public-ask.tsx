"use client";

import { Suspense, useCallback, useId, useRef, useState } from "react";
import { Send, Sparkles } from "lucide-react";
import { lazyPanel } from "@/lib/lazy-panel";
import type { ZekaSurface } from "@/lib/ai/zeka/types";
import "./public-ask.css";

/** Yanıt paneli ayrı parça: ilk odak/tıkta iner (public sayfa ilk yük paketine girmez). */
const panel = lazyPanel(() => import("./zeka-panel").then((m) => m.ZekaPanel));

type FormProps = {
  surface: ZekaSurface;
  placeholder: string;
  label: string;
  extraBody?: Record<string, unknown>;
  className: string;
  autoFocus?: boolean;
  onClosed?: () => void;
  /**
   * JS'siz yedek hedef (GET, `q`): statik ana sayfa Next betiği taşımaz; kutu hidrate olmadan gönderilirse tarayıcı
   * `/sor?q=…` tam sayfa sohbetine gider. Hidrate olunca `onSubmit` engeller ve yanıt yerinde açılır.
   */
  action?: string;
};

/** Ortak soru kutusu (combobox) + tembel Zeka paneli. Oturumsuz yüzeylerde son sorgular kalıcı tutulmaz. */
function AskForm({ surface, placeholder, label, extraBody, className, autoFocus, onClosed, action }: FormProps) {
  const [q, setQ] = useState("");
  const [view, setView] = useState<"closed" | "suggest" | "answer">("closed");
  const [submitted, setSubmitted] = useState<{ q: string; nonce: number } | null>(null);
  const [Panel, setPanel] = useState<ReturnType<typeof panel.resolve> | null>(null);
  const [form, setForm] = useState<HTMLFormElement | null>(null);
  const [input, setInput] = useState<HTMLInputElement | null>(null);
  const skipFocusOpen = useRef(false);
  const listboxId = `${useId().replace(/:/g, "")}-zeka`;
  const ensure = useCallback(() => setPanel((cur: ReturnType<typeof panel.resolve> | null) => cur ?? panel.resolve()), []);
  const close = useCallback(() => {
    setView("closed");
    skipFocusOpen.current = true;
    input?.focus();
    onClosed?.();
  }, [input, onClosed]);
  const submit = useCallback(
    (text: string) => {
      const value = text.trim();
      if (value.length < 2) return;
      ensure();
      setQ(value);
      setSubmitted((s) => ({ q: value, nonce: (s?.nonce ?? 0) + 1 }));
      setView("answer");
    },
    [ensure],
  );
  return (
    <>
      <form
        ref={setForm}
        role="search"
        className={className}
        action={action}
        method={action ? "get" : undefined}
        onSubmit={(e) => {
          e.preventDefault();
          submit(q);
        }}
      >
        <Sparkles className="zp-ico" aria-hidden="true" />
        <label className="sr-only" htmlFor={`${listboxId}-in`}>
          {label}
        </label>
        <input
          id={`${listboxId}-in`}
          ref={setInput}
          name={action ? "q" : undefined}
          className="zp-input"
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={false}
          aria-controls={listboxId}
          autoComplete="off"
          enterKeyHint="send"
          maxLength={300}
          autoFocus={autoFocus}
          value={q}
          placeholder={placeholder}
          onPointerEnter={panel.preload}
          onFocus={() => {
            ensure();
            if (skipFocusOpen.current) {
              skipFocusOpen.current = false;
              return;
            }
            if (view === "closed" && q.trim().length >= 2) setView("suggest");
          }}
          onChange={(e) => {
            setQ(e.target.value);
            ensure();
            setView("suggest");
          }}
        />
        <button type="submit" className="zp-go" aria-label="Sor">
          <Send className="h-4 w-4" aria-hidden="true" />
        </button>
      </form>
      {Panel && view !== "closed" ? (
        <Suspense fallback={null}>
          <Panel
            surface={surface}
            extraBody={extraBody}
            query={q}
            view={view}
            submitted={submitted}
            anchor={form}
            input={input}
            listboxId={listboxId}
            recentsKey={null}
            onSubmit={submit}
            onClose={close}
          />
        </Suspense>
      ) : null}
    </>
  );
}

/** Ana sayfa kahramanındaki küçük "EmlakSoft'a sor" kutusu (yalnız giriş; motor sunucuda). */
export function ZekaHeroAsk() {
  return <AskForm surface="public" action="/sor" className="zp-hero" label="EmlakSoft'a sorun" placeholder="EmlakSoft'a sorun: fiyatlar, özellikler, KVKK…" />;
}
