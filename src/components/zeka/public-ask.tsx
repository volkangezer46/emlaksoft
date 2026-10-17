"use client";

import { Suspense, useCallback, useEffect, useId, useRef, useState } from "react";
import { MessageCircleQuestion, Send, Sparkles, X } from "lucide-react";
import { lazyPanel } from "@/lib/lazy-panel";
import { runWhenIdle } from "@/lib/idle";
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
};

/** Ortak soru kutusu (combobox) + tembel Zeka paneli. Oturumsuz yüzeylerde son sorgular kalıcı tutulmaz. */
function AskForm({ surface, placeholder, label, extraBody, className, autoFocus, onClosed }: FormProps) {
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
  return <AskForm surface="public" className="zp-hero" label="EmlakSoft'a sorun" placeholder="EmlakSoft'a sorun: fiyatlar, özellikler, KVKK…" />;
}

/**
 * Yüzen asistan düğmesi (public sayfalar ve vitrin): tıklayınca küçük soru kartı açılır. Vitrinde `extraBody.slug` ile o
 * ofisin YAYINDAKİ ilanlarında doğal dille arar.
 */
export function ZekaFloatingAsk({
  surface = "public",
  extraBody,
  title = "EmlakSoft'a sor",
  placeholder = "Fiyat, özellik ya da kullanım sorun…",
}: {
  surface?: ZekaSurface;
  extraBody?: Record<string, unknown>;
  title?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => runWhenIdle(panel.preload), []);
  const body = useStableBody(extraBody);
  return (
    <div className={`zp-float${open ? " is-open" : ""}`}>
      {open ? (
        <div className="zp-card" role="dialog" aria-label={title}>
          <div className="zp-card-head">
            <span className="zp-card-title">
              <Sparkles className="h-4 w-4" aria-hidden="true" /> {title}
            </span>
            <button type="button" className="zp-x" aria-label="Kapat" onClick={() => setOpen(false)}>
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <AskForm surface={surface} extraBody={body} className="zp-compose" label={title} placeholder={placeholder} autoFocus />
        </div>
      ) : null}
      {!open ? (
        <button type="button" className="zp-fab" onClick={() => setOpen(true)} onPointerEnter={panel.preload} aria-label={title}>
          <MessageCircleQuestion className="h-5 w-5" aria-hidden="true" />
          <span className="zp-fab-label">{title}</span>
        </button>
      ) : null}
    </div>
  );
}

/** extraBody nesnesi her çizimde yeniden oluşmasın (panel isteği yeniden tetiklenmesin). */
function useStableBody(body: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  const key = body ? JSON.stringify(body) : "";
  const [state, setState] = useState<{ key: string; body: Record<string, unknown> | undefined }>({ key, body });
  if (state.key !== key) setState({ key, body });
  return state.body;
}
