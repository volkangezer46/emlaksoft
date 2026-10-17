"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, Maximize2, Minimize2, SquarePen, X } from "lucide-react";
import { pushRecent, sendZekaFeedback, streamZeka } from "@/lib/ai/zeka/client";
import { zekaStarters } from "@/lib/ai/zeka/starters";
import { autoAskOnce } from "@/lib/ai/zeka/sor";
import { clearConversation, conversationKey, loadConversation, saveConversation, sessionStore, ZEKA_CONV_MAX_TURNS, type StoredTurn } from "@/lib/ai/zeka/conversation";
import { formatTrTime, now } from "@/lib/clock";
import type { ZekaEngineId, ZekaSurface } from "@/lib/ai/zeka/types";
import { AnswerBody, MessageTools, RetryChip, TypingDots, useIsPhone, ZekaMarkdown, ZekaNotice, ZekaOrb } from "./zeka-message";
import "./zeka-dock.css";

/**
 * EmlakSoft Zeka SOHBET PENCERESİ (yüzen "Zeka'ya sor" düğmesinin açtığı pencere + /sor tam sayfa sohbeti). Tek sohbet
 * uygulamasıdır: mesaj bileşenleri komut çubuğu paneliyle ortak (`zeka-message.tsx`), uç noktalar aynı.
 *  - Yerleşim: masaüstünde sağ altta düğmenin ÜSTÜNDE ~400×640 pencere (köşeden ölçek + solma ile açılır), "Genişlet" ile
 *    ortada büyük kip; telefonda (< 640 px) tam ekran (güvenli alanlarla). `layout="page"`: /sor sayfasına gömülü.
 *  - Akış: yanıt `streamZeka` ile gelir (GPT metni parça parça; kartlar/eylemler sonda). Yerel yanıt ≤300 ms açılışla.
 *    "Yanıtı durdur" ve pencereyi kapatma isteği iptal eder (AbortController).
 *  - Konuşma kullanıcı başına sekme oturumunda (sessionStorage) saklanır; her soru son 3 soruyla (`history`) gider.
 *  - Erişilebilirlik: role=dialog, odak tuzağı, Esc kapatır, akan metin role=log (aria-live) içinde.
 */

export type ZekaDockProps = {
  surface: ZekaSurface;
  /** Bulunduğu yol (başlangıç soruları + sunucu bağlamı). */
  page: string;
  /** Kullanıcı rolü (yalnız başlangıç sorusu seçimi; yetki sunucuda). */
  role?: string | null;
  /** Pencere adı (vitrin: "İlan asistanı"); başlıkta "EmlakSoft Zeka" görünür. */
  title?: string;
  placeholder?: string;
  extraBody?: Record<string, unknown>;
  recentsKey?: string | null;
  /** Karşılama için kullanıcının adı (app/admin). */
  userName?: string | null;
  /** Yüzen pencerede zorunlu; tam sayfa (`layout="page"`) yerleşimde kapatma yoktur. */
  onClose?: () => void;
  /** "float": sağ altta yüzen pencere (varsayılan). "page": /sor sayfasına gömülü tam sayfa sohbet (portal/Esc/kapat yok). */
  layout?: "float" | "page";
  /** Açılışta BİR KEZ kendiliğinden sorulan soru (/sor?q=…). */
  initialQuestion?: string | null;
};

type Turn = Omit<StoredTurn, "status"> & { status: StoredTurn["status"] | "pending" | "streaming"; fresh?: boolean };

const noop = () => {};
const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

function surfaceLine(surface: ZekaSurface): string {
  if (surface === "app") return "Kayıtlarınızı arar, sayıları getirir, sayfaları açar ve formları ön doldurur; hiçbir kaydı kendisi yazmaz.";
  if (surface === "admin") return "Platform özetini ve yönetim sayfalarını salt okunur getirir.";
  if (surface === "vitrin") return "Bu ofisin yayındaki ilanlarında arar; talebinizi formla siz iletirsiniz.";
  return "Paketler, fiyatlar, özellikler ve kullanım hakkında yanıt verir.";
}

export function ZekaDock({
  surface,
  page,
  role,
  title = "Zeka'ya sor",
  placeholder = "Sorunuzu yazın…",
  extraBody,
  recentsKey = null,
  userName = null,
  onClose: onCloseProp,
  layout = "float",
  initialQuestion = null,
}: ZekaDockProps) {
  const inPage = layout === "page";
  const onClose = onCloseProp ?? noop;
  const isPhone = useIsPhone();
  const phone = isPhone && !inPage;
  const convKey = useMemo(() => (inPage ? null : conversationKey(surface, recentsKey, typeof extraBody?.slug === "string" ? extraBody.slug : null)), [inPage, surface, recentsKey, extraBody]);
  const [turns, setTurns] = useState<Turn[]>(() => loadConversation(inPage ? null : sessionStore(), convKey));
  const [engine, setEngine] = useState<ZekaEngineId | null>(() => [...turns].reverse().find((t) => t.result)?.result?.engine ?? null);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [jump, setJump] = useState(false);
  const autoAsked = useRef(false);
  const busyRef = useRef(false);
  const ctlRef = useRef<AbortController | null>(null);
  const turnsRef = useRef<Turn[]>(turns);
  const atBottom = useRef(true);
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const baseId = `${useId().replace(/:/g, "")}-zk-dock`;
  const starters = useMemo(() => zekaStarters(surface, page, role), [surface, page, role]);
  const firstName = ((userName ?? "").trim().split(/\s+/)[0] ?? "").slice(0, 40).replace(/^.*@.*$/, "") || null;
  const heading = surface === "vitrin" ? title : "EmlakSoft Zeka";

  useEffect(() => {
    turnsRef.current = turns;
  }, [turns]);

  // Konuşmayı sakla (akış sürerken her karede değil; yanıt bitince). Kapanışta yarım tur "durduruldu" olarak yazılır.
  useEffect(() => {
    if (!busy && convKey) saveConversation(sessionStore(), convKey, turns as StoredTurn[]);
  }, [turns, busy, convKey]);
  useEffect(
    () => () => {
      ctlRef.current?.abort();
      if (convKey) {
        const list = turnsRef.current.map((t) => (t.status === "pending" || t.status === "streaming" ? { ...t, status: "stopped" as const } : t));
        saveConversation(sessionStore(), convKey, list as StoredTurn[]);
      }
    },
    [convKey],
  );

  const patch = useCallback((id: number, fn: (t: Turn) => Turn) => setTurns((ts) => ts.map((t) => (t.id === id ? fn(t) : t))), []);

  const ask = useCallback(
    (raw: string) => {
      const q = raw.trim().slice(0, 300);
      if (q.length < 2 || busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      const prev = turnsRef.current;
      const id = prev.reduce((m, t) => Math.max(m, t.id), 0) + 1;
      const history = prev.filter((t) => t.status === "done").map((t) => t.q).slice(-3);
      setTurns((ts) => [...ts, { id, q, at: now(), status: "pending" as const, text: "", result: null, error: null }].slice(-ZEKA_CONV_MAX_TURNS));
      setText("");
      if (inputRef.current) inputRef.current.style.height = "";
      atBottom.current = true;
      const ctl = new AbortController();
      ctlRef.current = ctl;
      let buf = "";
      let raf = 0;
      let streamed = false;
      const flush = () => {
        raf = 0;
        const chunk = buf;
        buf = "";
        if (chunk) patch(id, (t) => ({ ...t, status: "streaming", text: t.text + chunk }));
      };
      void streamZeka(
        surface,
        { q, history, page, ...extraBody },
        {
          onEngine: (e) => {
            setEngine(e);
            patch(id, (t) => ({ ...t, engine: e }));
          },
          onDelta: (d) => {
            streamed = true;
            buf += d;
            if (!raf) raf = requestAnimationFrame(flush);
          },
          onReset: () => {
            buf = "";
            streamed = false;
            patch(id, (t) => ({ ...t, text: "" }));
          },
        },
        ctl.signal,
      ).then((r) => {
        if (raf) cancelAnimationFrame(raf);
        flush();
        if (ctlRef.current === ctl) ctlRef.current = null;
        busyRef.current = false;
        setBusy(false);
        if (r.ok) {
          setEngine(r.result.engine);
          if (recentsKey) pushRecent(recentsKey, q);
          patch(id, (t) => ({ ...t, status: "done", result: r.result, text: r.result.answer, engine: r.result.engine, fresh: !streamed }));
        } else if (r.aborted) {
          patch(id, (t) => ({ ...t, status: "stopped" }));
        } else {
          patch(id, (t) => ({ ...t, status: "error", error: r.error || "Zeka şu an yanıt veremedi.", limited: r.status === 429 }));
        }
      });
    },
    [surface, page, extraBody, recentsKey, patch],
  );

  const stop = useCallback(() => ctlRef.current?.abort(), []);
  const reset = useCallback(() => {
    ctlRef.current?.abort();
    setTurns([]);
    clearConversation(sessionStore(), convKey);
    inputRef.current?.focus();
  }, [convKey]);
  const retry = useCallback(
    (t: Turn) => {
      if (busyRef.current) return;
      setTurns((ts) => ts.filter((x) => x.id !== t.id));
      turnsRef.current = turnsRef.current.filter((x) => x.id !== t.id);
      ask(t.q);
    },
    [ask],
  );

  // /sor?q=… : soru açılışta yalnız BİR KEZ gönderilir (ref koruması; Strict Mode çift etkisi ve yeniden çizim tekrar sormaz).
  useEffect(() => {
    autoAskOnce(autoAsked, initialQuestion, ask);
  }, [initialQuestion, ask]);

  // Kaydırma alta sabit: içerik büyüdüğünde kullanıcı alttaysa izler; yukarı kaydırdıysa "Yeni mesaj" düğmesi çıkar.
  useEffect(() => {
    const el = scrollRef.current;
    const inner = innerRef.current;
    if (!el || !inner || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (atBottom.current) el.scrollTop = el.scrollHeight;
      else setJump(true);
    });
    ro.observe(inner);
    return () => ro.disconnect();
  }, []);
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    atBottom.current = bottom;
    if (bottom) setJump(false);
  }, []);
  const toBottom = useCallback(() => {
    const el = scrollRef.current;
    atBottom.current = true;
    setJump(false);
    el?.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, []);

  // İlk odak: masaüstünde yazma kutusu; telefonda pencerenin kendisi (klavye kendiliğinden açılmasın).
  useEffect(() => {
    if (inPage) return;
    if (isPhone) panelRef.current?.focus();
    else inputRef.current?.focus();
  }, [inPage, isPhone]);

  // Esc kapatır (akış sürüyorsa kapanışla iptal edilir).
  useEffect(() => {
    if (inPage) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, inPage]);

  // Odak tuzağı (yüzen pencere): Tab son öğeden ilke, Shift+Tab ilkten sona döner.
  const trap = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (inPage || e.key !== "Tab" || !panelRef.current) return;
      const items = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null || n === document.activeElement);
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panelRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [inPage],
  );

  if (!inPage && typeof document === "undefined") return null;
  const empty = turns.length === 0;
  const lastDone = [...turns].reverse().find((t) => t.status === "done")?.id ?? null;
  const status = engine === "gpt" ? "Çevrimiçi · GPT" : engine === "local" ? "Yerel zeka" : "Çevrimiçi";
  const canExpand = !inPage && !phone;
  const big = canExpand && expanded;

  const tree = (
    <>
      {phone || big ? <div className={`zk-scrim${big ? " is-big" : ""}`} aria-hidden="true" onClick={big ? () => setExpanded(false) : onClose} /> : null}
      <div
        ref={panelRef}
        className={`zk-panel zk-dock${phone ? " is-sheet" : ""}${inPage ? " is-page" : ""}${big ? " is-expanded" : ""}`}
        role={inPage ? "region" : "dialog"}
        aria-modal={inPage ? undefined : true}
        aria-labelledby={`${baseId}-title`}
        tabIndex={inPage ? undefined : -1}
        onKeyDown={trap}
        data-zeka-dock=""
      >
        <header className="zk-dhead">
          <ZekaOrb size="md" />
          <div className="zk-dhead-text">
            <p className="zk-dtitle" id={`${baseId}-title`}>
              {heading}
            </p>
            <p className="zk-status" data-zeka-status={engine ?? "unknown"}>
              <i className={`zk-live${engine === "local" ? " is-local" : ""}`} aria-hidden="true" />
              {status}
            </p>
          </div>
          <div className="zk-dhead-actions">
            {turns.length > 0 ? (
              <button type="button" className="zk-hbtn" onClick={reset} aria-label="Yeni konuşma başlat" title="Yeni konuşma">
                <SquarePen className="h-4 w-4" aria-hidden="true" />
              </button>
            ) : null}
            {canExpand ? (
              <button type="button" className="zk-hbtn" onClick={() => setExpanded((x) => !x)} aria-pressed={expanded} aria-label={expanded ? "Pencereyi küçült" : "Pencereyi genişlet"} title={expanded ? "Küçült" : "Genişlet"}>
                {expanded ? <Minimize2 className="h-4 w-4" aria-hidden="true" /> : <Maximize2 className="h-4 w-4" aria-hidden="true" />}
              </button>
            ) : null}
            {inPage ? null : (
              <button type="button" className="zk-hbtn" onClick={onClose} aria-label="Zeka penceresini kapat" title="Kapat (Esc)">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>
        </header>

        <div ref={scrollRef} className="zk-thread" role="log" aria-live="polite" aria-relevant="additions text" aria-label="Konuşma" onScroll={onScroll}>
          <div ref={innerRef} className="zk-thread-in">
            {empty ? (
              <div className="zk-hello">
                <ZekaOrb size="lg" />
                <p className="zk-hello-title">{firstName ? `Merhaba ${firstName},` : "Merhaba,"} size nasıl yardımcı olabilirim?</p>
                <p className="zk-hello-sub">
                  {starters.topic ? `${starters.topic} sayfasındasınız. ` : ""}
                  {surfaceLine(surface)}
                </p>
                <div className="zk-starters" role="group" aria-label="Önerilen sorular">
                  {starters.items.map((q) =>
                    inPage ? (
                      <a
                        key={q}
                        href={`/sor?q=${encodeURIComponent(q)}`}
                        className="zk-chip"
                        onClick={(e) => {
                          e.preventDefault();
                          ask(q);
                        }}
                      >
                        {q}
                      </a>
                    ) : (
                      <button key={q} type="button" className="zk-chip" onClick={() => ask(q)}>
                        {q}
                      </button>
                    ),
                  )}
                </div>
              </div>
            ) : null}
            {turns.map((t) => (
              <section key={t.id} className="zk-turn" aria-label={`Soru: ${t.q}`}>
                <div className="zk-urow">
                  <p className="zk-ask">{t.q}</p>
                  {t.at ? <TimeStamp at={t.at} /> : null}
                </div>
                <div className="zk-arow">
                  <ZekaOrb size="sm" />
                  <div className="zk-bubble" aria-busy={t.status === "pending" || t.status === "streaming"}>
                    <AssistantTurn
                      turn={t}
                      isLast={t.id === lastDone}
                      busy={busy}
                      onFollow={ask}
                      onClose={inPage ? noop : onClose}
                      onRetry={() => retry(t)}
                      onVote={(v) => {
                        if (!t.result?.logId || t.vote) return;
                        patch(t.id, (x) => ({ ...x, vote: v }));
                        void sendZekaFeedback(t.result.logId, v);
                      }}
                    />
                  </div>
                </div>
              </section>
            ))}
          </div>
        </div>
        {jump ? (
          <button type="button" className="zk-jump" onClick={toBottom}>
            <ArrowDown className="h-4 w-4" aria-hidden="true" /> Yeni mesaj
          </button>
        ) : null}

        <form
          className="zk-compose"
          action={inPage ? "/sor" : undefined}
          method={inPage ? "get" : undefined}
          onSubmit={(e) => {
            e.preventDefault();
            ask(text);
          }}
        >
          <div className="zk-compose-box">
            <label className="sr-only" htmlFor={baseId}>
              {title}
            </label>
            <textarea
              id={baseId}
              ref={inputRef}
              name={inPage ? "q" : undefined}
              className="zk-compose-input"
              rows={1}
              autoComplete="off"
              enterKeyHint="send"
              maxLength={300}
              value={text}
              placeholder={turns.length > 0 ? "Devam sorusu yazın…" : placeholder}
              onChange={(e) => {
                setText(e.target.value);
                const el = e.currentTarget;
                el.style.height = "auto";
                el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  ask(text);
                }
              }}
            />
            {busy ? (
              <button type="button" className="zk-compose-go is-stop" onClick={stop} aria-label="Yanıtı durdur" title="Yanıtı durdur">
                <span className="zk-stop-ico" aria-hidden="true" />
              </button>
            ) : (
              <button type="submit" className="zk-compose-go" aria-label="Gönder" title="Gönder (Enter)" disabled={text.trim().length < 2}>
                <ArrowUp className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>
          <p className="zk-foot">Zeka hata yapabilir; önemli bilgileri kontrol edin.</p>
        </form>
      </div>
    </>
  );
  return inPage ? tree : createPortal(tree, document.body);
}

function TimeStamp({ at }: { at: number }) {
  return <span className="zk-time zk-utime">{formatTrTime(at)}</span>;
}

function AssistantTurn({
  turn: t,
  isLast,
  busy,
  onFollow,
  onClose,
  onRetry,
  onVote,
}: {
  turn: Turn;
  isLast: boolean;
  busy: boolean;
  onFollow: (q: string) => void;
  onClose: () => void;
  onRetry: () => void;
  onVote: (v: 1 | -1) => void;
}) {
  if (t.status === "pending") return <TypingDots />;
  if (t.status === "streaming") return <ZekaMarkdown text={t.text} caret />;
  if (t.status === "error") {
    return (
      <ZekaNotice text={t.error ?? "Zeka şu an yanıt veremedi."} limited={t.limited}>
        {t.limited ? null : <RetryChip onClick={onRetry} disabled={busy} />}
      </ZekaNotice>
    );
  }
  if (t.status === "stopped" || !t.result) {
    return (
      <>
        {t.text ? <ZekaMarkdown text={t.text} /> : null}
        <p className="zk-note">Yanıt durduruldu.</p>
        <div className="zk-follow">
          <RetryChip onClick={onRetry} disabled={busy} />
        </div>
      </>
    );
  }
  return (
    <>
      <AnswerBody result={t.result} text={t.text || t.result.answer} reveal={Boolean(t.fresh)} followUps={isLast && !busy} onFollow={onFollow} onClose={onClose} />
      <MessageTools text={t.text || t.result.answer} logId={t.result.logId} voted={t.vote ?? null} onVote={onVote} at={t.at} />
    </>
  );
}
