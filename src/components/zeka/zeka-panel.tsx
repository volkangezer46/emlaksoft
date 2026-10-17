"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  Building2,
  Compass,
  CornerDownLeft,
  History,
  Plus,
  Search,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  User,
  X,
} from "lucide-react";
import { fetchZeka, pushRecent, readRecent, sendZekaFeedback } from "@/lib/ai/zeka/client";
import { ZEKA_LOW_CONFIDENCE, type ZekaAction, type ZekaCard, type ZekaResult, type ZekaSurface } from "@/lib/ai/zeka/types";
import "./zeka.css";

/**
 * Zeka yanıt paneli — TEMBEL parça (ilk etkileşimde iner; ana ekran / public paketine girmez).
 *  - Öneri kipi: yazarken (220 ms gecikmeli) yalnız YEREL motordan hızlı öneriler; combobox + listbox (ok tuşları, Enter, Esc).
 *  - Yanıt kipi: Enter ile gerçek yanıt; masaüstünde komut çubuğunun altında, telefonda alt çekmece. Portal ile
 *    `document.body` üstünde çizilir (kart `overflow`/`transform` kuralları kırpamaz, hiçbir katmanın arkasında kalmaz).
 *  - Zeka hiçbir kayıt YAZMAZ: "oluştur" düğmesi ön doldurulmuş formu açar, kayıt kullanıcı formu kaydedince oluşur.
 */

export type ZekaPanelProps = {
  surface: ZekaSurface;
  /** Uç noktaya eklenecek alanlar (vitrin: slug). */
  extraBody?: Record<string, unknown>;
  /** Kutudaki güncel metin (öneri kipi). */
  query: string;
  view: "suggest" | "answer";
  /** Yanıt istenen sorgu (her gönderimde `nonce` artar). */
  submitted: { q: string; nonce: number } | null;
  /** Masaüstünde panelin hizalanacağı kutu; yoksa ekran üstünde ortalı. */
  anchor: HTMLElement | null;
  /** Klavye gezinmesi için giriş kutusu. */
  input: HTMLInputElement | null;
  listboxId: string;
  recentsKey: string | null;
  onSubmit: (q: string) => void;
  onClose: () => void;
};

type Option = { id: string; label: string; hint?: string; href?: string; q?: string; icon: "ask" | "recent" | "nav" | "create" | "record" | "help" };

const PHONE_MQ = "(max-width: 639.98px)";
const SUGGEST_DEBOUNCE_MS = 220;

function useIsPhone(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(PHONE_MQ);
    const on = () => setPhone(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return phone;
}

type Pos = { top: number; left: number; width: number; maxHeight: number } | null;

function useAnchorPos(anchor: HTMLElement | null, active: boolean): Pos {
  const [pos, setPos] = useState<Pos>(null);
  useLayoutEffect(() => {
    if (!active) return;
    let raf = 0;
    const measure = () => {
      raf = 0;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      if (!anchor) {
        const width = Math.min(720, vw - 32);
        setPos({ top: Math.round(vh * 0.12), left: Math.round((vw - width) / 2), width, maxHeight: Math.round(vh * 0.76) });
        return;
      }
      const r = anchor.getBoundingClientRect();
      const width = Math.min(Math.max(r.width, 360), 760, vw - 16);
      const left = Math.min(Math.max(8, r.left), vw - width - 8);
      const below = vh - r.bottom - 16;
      const top = below >= 260 ? r.bottom + 8 : Math.max(8, r.top - Math.min(520, r.top - 16) - 8);
      setPos({ top, left, width, maxHeight: below >= 260 ? Math.min(560, below) : Math.min(520, r.top - 24) });
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
    };
  }, [anchor, active]);
  return pos;
}

export function ZekaPanel(props: ZekaPanelProps) {
  const { surface, extraBody, query, view, submitted, anchor, input, listboxId, recentsKey, onSubmit, onClose } = props;
  const phone = useIsPhone();
  const router = useRouter();
  const [suggestState, setSuggestState] = useState<{ q: string; result: ZekaResult | null } | null>(null);
  const [answerState, setAnswerState] = useState<{ nonce: number; result: ZekaResult | null; error: string | null } | null>(null);
  const [activeState, setActiveState] = useState<{ key: string; i: number }>({ key: "", i: 0 });
  const [recents, setRecents] = useState<string[]>(() => readRecent(recentsKey));
  const [voteState, setVoteState] = useState<{ nonce: number; v: 1 | -1 } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const sheet = phone && view === "answer";
  const pos = useAnchorPos(anchor, !sheet);

  // Öneri: yalnız yerel motor (sunucu `mode: "suggest"`), gecikmeli; eski istek iptal edilir. Durum yalnız yanıt gelince yazılır.
  const trimmed = query.trim();
  useEffect(() => {
    if (view !== "suggest" || trimmed.length < 2) return;
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      const r = await fetchZeka(surface, { q: trimmed, mode: "suggest", ...extraBody }, ctl.signal);
      if (!ctl.signal.aborted) setSuggestState({ q: trimmed, result: r.ok ? r.result : null });
    }, SUGGEST_DEBOUNCE_MS);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [trimmed, view, surface, extraBody]);
  const suggest = view === "suggest" && trimmed.length >= 2 && suggestState?.q === trimmed ? suggestState.result : null;

  // Yanıt (her gönderim kendi `nonce`u ile; eski yanıt yeni gönderimde görünmez).
  useEffect(() => {
    if (view !== "answer" || !submitted) return;
    const ctl = new AbortController();
    void fetchZeka(surface, { q: submitted.q, mode: "answer", ...extraBody }, ctl.signal).then((r) => {
      if (ctl.signal.aborted) return;
      setRecents(pushRecent(recentsKey, submitted.q));
      setAnswerState({ nonce: submitted.nonce, result: r.ok ? r.result : null, error: r.ok ? null : r.error || "Zeka şu an yanıt veremedi." });
    });
    return () => ctl.abort();
  }, [submitted, view, surface, extraBody, recentsKey]);
  const current = submitted && answerState?.nonce === submitted.nonce ? answerState : null;
  const loading = view === "answer" && Boolean(submitted) && !current;
  const answer = current?.result ?? null;
  const error = current?.error ?? null;
  const voted = submitted && voteState?.nonce === submitted.nonce ? voteState.v : null;

  const options = useMemo<Option[]>(() => {
    if (view !== "suggest") return [];
    if (trimmed.length < 2) {
      return recents.map((r, i) => ({ id: `r${i}`, label: r, q: r, icon: "recent" as const }));
    }
    const out: Option[] = [{ id: "ask", label: `Zeka'ya sor: “${trimmed}”`, q: trimmed, icon: "ask", hint: "Enter" }];
    const seen = new Set<string>();
    for (const a of suggest?.actions ?? []) {
      if (seen.has(a.href)) continue;
      seen.add(a.href);
      out.push({ id: `a${out.length}`, label: a.label, href: a.href, icon: a.kind === "create" ? "create" : "nav", hint: a.kind === "create" ? "Form açılır" : undefined });
    }
    for (const c of suggest?.cards ?? []) {
      const href = "href" in c ? c.href : undefined;
      if (!href || seen.has(href)) continue;
      seen.add(href);
      if (c.kind === "record") out.push({ id: `c${out.length}`, label: c.title, hint: c.subtitle, href, icon: "record" });
      else if (c.kind === "nav") out.push({ id: `c${out.length}`, label: c.label, hint: c.description, href, icon: "nav" });
      else if (c.kind === "help") out.push({ id: `c${out.length}`, label: c.title, href, icon: "help" });
    }
    return out.slice(0, 8);
  }, [view, trimmed, recents, suggest]);

  const activeKey = `${trimmed}|${options.length}`;
  const active = activeState.key === activeKey ? Math.min(activeState.i, Math.max(0, options.length - 1)) : 0;
  const setActive = useCallback((next: number | ((i: number) => number)) => {
    setActiveState((st) => {
      const cur = st.key === activeKey ? st.i : 0;
      return { key: activeKey, i: typeof next === "function" ? next(cur) : next };
    });
  }, [activeKey]);

  const go = useCallback(
    (o: Option | undefined) => {
      if (!o) return;
      if (o.q) onSubmit(o.q);
      else if (o.href) {
        onClose();
        router.push(o.href);
      }
    },
    [onSubmit, onClose, router],
  );

  // Klavye: kutuya bağlı (combobox). Seçili öneri varsa Enter onu açar, yoksa form gönderilir (yanıt kipi).
  useEffect(() => {
    if (!input) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (view !== "suggest" || options.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => (i + 1) % options.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => (i - 1 + options.length) % options.length);
      } else if (e.key === "Enter" && !e.isComposing && active > 0) {
        e.preventDefault();
        go(options[active]);
      }
    };
    input.addEventListener("keydown", onKey);
    return () => input.removeEventListener("keydown", onKey);
  }, [input, view, options, active, go, onClose, setActive]);

  // aria-activedescendant + aria-expanded kutunun üzerinde
  useEffect(() => {
    if (!input) return;
    const open = view === "answer" || options.length > 0;
    input.setAttribute("aria-expanded", open ? "true" : "false");
    if (view === "suggest" && options[active]) input.setAttribute("aria-activedescendant", `${listboxId}-${options[active]!.id}`);
    else input.removeAttribute("aria-activedescendant");
    return () => {
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
    };
  }, [input, view, options, active, listboxId]);

  // Dış tıklama kapatır (kutu ve panel hariç); yanıt kipinde Esc her yerden.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || anchor?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && view === "answer") onClose();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [anchor, onClose, view]);

  if (typeof document === "undefined") return null;
  if (view === "suggest" && options.length === 0) return null;

  const style = sheet || !pos ? undefined : { top: pos.top, left: pos.left, width: pos.width, maxHeight: pos.maxHeight };
  const body =
    view === "suggest" ? (
      <ul id={listboxId} role="listbox" aria-label={trimmed.length < 2 ? "Son sorgular" : "Zeka önerileri"} className="zk-list">
        {trimmed.length < 2 ? <li role="presentation" className="zk-group">Son sorgular</li> : null}
        {options.map((o, i) => (
          <li
            key={o.id}
            id={`${listboxId}-${o.id}`}
            role="option"
            aria-selected={i === active}
            className={`zk-opt${i === active ? " is-active" : ""}`}
            onPointerEnter={() => setActive(i)}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => go(o)}
          >
            <span className={`zk-opt-ico t-${o.icon}`} aria-hidden="true">
              <OptIcon kind={o.icon} />
            </span>
            <span className="zk-opt-text">
              <span className="zk-opt-label">{o.label}</span>
              {o.hint && o.icon !== "ask" ? <span className="zk-opt-hint">{o.hint}</span> : null}
            </span>
            {o.icon === "ask" ? (
              <kbd className="zk-kbd" aria-hidden="true">
                <CornerDownLeft className="h-3 w-3" />
              </kbd>
            ) : null}
          </li>
        ))}
      </ul>
    ) : (
      <AnswerView
        q={submitted?.q ?? ""}
        loading={loading}
        error={error}
        result={answer}
        voted={voted}
        onVote={async (v) => {
          if (!answer?.logId || voted || !submitted) return;
          setVoteState({ nonce: submitted.nonce, v });
          await sendZekaFeedback(answer.logId, v);
        }}
        onFollow={(q) => onSubmit(q)}
        onClose={onClose}
        onRetry={() => submitted && onSubmit(submitted.q)}
      />
    );

  return createPortal(
    <>
      {sheet ? <div className="zk-scrim" aria-hidden="true" onClick={onClose} /> : null}
      <div
        ref={panelRef}
        className={`zk-panel${sheet ? " is-sheet" : ""}${view === "suggest" ? " is-suggest" : ""}`}
        style={style}
        role={view === "answer" ? "dialog" : undefined}
        aria-modal={sheet ? true : undefined}
        aria-label={view === "answer" ? "Zeka yanıtı" : undefined}
        data-zeka-panel=""
      >
        {sheet ? <span className="zk-grip" aria-hidden="true" /> : null}
        {body}
      </div>
    </>,
    document.body,
  );
}

function OptIcon({ kind }: { kind: Option["icon"] }) {
  const cls = "h-4 w-4";
  switch (kind) {
    case "ask":
      return <Sparkles className={cls} />;
    case "recent":
      return <History className={cls} />;
    case "create":
      return <Plus className={cls} />;
    case "record":
      return <User className={cls} />;
    case "help":
      return <BookOpen className={cls} />;
    default:
      return <Compass className={cls} />;
  }
}

function AnswerView({
  q,
  loading,
  error,
  result,
  voted,
  onVote,
  onFollow,
  onClose,
  onRetry,
}: {
  q: string;
  loading: boolean;
  error: string | null;
  result: ZekaResult | null;
  voted: 1 | -1 | null;
  onVote: (v: 1 | -1) => void;
  onFollow: (q: string) => void;
  onClose: () => void;
  onRetry: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const low = result ? !result.answered || result.confidence < ZEKA_LOW_CONFIDENCE : false;
  return (
    <div className="zk-answer" aria-busy={loading}>
      <header className="zk-head">
        <span className="zk-head-ico" aria-hidden="true">
          <Sparkles className="h-4 w-4" />
        </span>
        <p className="zk-q" title={q}>
          {q}
        </p>
        {result ? (
          <span className={`zk-badge${result.engine === "gpt" ? " is-gpt" : ""}`} title={result.fallbackReason ? "GPT kullanılamadı; yerel zeka yanıtladı" : undefined}>
            {result.engine === "gpt" ? "GPT" : "Yerel zeka"}
          </span>
        ) : null}
        <button ref={closeRef} type="button" className="zk-close" onClick={onClose} aria-label="Zeka panelini kapat">
          <X className="h-4 w-4" />
        </button>
      </header>
      <div className="zk-scroll" aria-live="polite">
        {loading ? (
          <div className="zk-skel" aria-label="Zeka düşünüyor">
            <span />
            <span />
            <span className="is-short" />
            <div className="zk-skel-cards">
              <i />
              <i />
            </div>
          </div>
        ) : error ? (
          <div className="zk-error">
            <p>{error}</p>
            <button type="button" className="zk-chip" onClick={onRetry}>
              Tekrar dene
            </button>
          </div>
        ) : result ? (
          <>
            <p className="zk-text">{result.answer}</p>
            {low && result.answered ? <p className="zk-note">Emin değilim; en yakın seçenekleri gösteriyorum.</p> : null}
            {result.cards.length > 0 ? (
              <div className="zk-cards">
                {result.cards.map((c, i) => (
                  <CardView key={`${c.kind}-${i}`} card={c} onClose={onClose} />
                ))}
              </div>
            ) : null}
            {result.actions.length > 0 ? (
              <div className="zk-actions">
                {result.actions.map((a, i) => (
                  <ActionView key={`${a.href}-${i}`} action={a} primary={i === 0} onClose={onClose} />
                ))}
              </div>
            ) : null}
            {result.followUps.length > 0 ? (
              <div className="zk-follow" role="group" aria-label="Devam soruları">
                {result.followUps.map((f) => (
                  <button key={f} type="button" className="zk-chip" onClick={() => onFollow(f)}>
                    {f}
                  </button>
                ))}
              </div>
            ) : null}
            {result.logId ? (
              <div className="zk-vote">
                <span>Yanıt işinize yaradı mı?</span>
                <button type="button" aria-pressed={voted === 1} aria-label="Evet, yararlı" disabled={voted !== null} onClick={() => onVote(1)}>
                  <ThumbsUp className="h-4 w-4" />
                </button>
                <button type="button" aria-pressed={voted === -1} aria-label="Hayır, yararlı değil" disabled={voted !== null} onClick={() => onVote(-1)}>
                  <ThumbsDown className="h-4 w-4" />
                </button>
                {voted ? <span className="zk-thanks">Teşekkürler</span> : null}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

function CardView({ card, onClose }: { card: ZekaCard; onClose: () => void }) {
  if (card.kind === "metric") {
    const inner = (
      <>
        <span className="zk-metric-label">{card.label}</span>
        <span className="zk-metric-value">{card.value}</span>
        {card.hint ? <span className="zk-metric-hint">{card.hint}</span> : null}
      </>
    );
    return card.href ? (
      <Link href={card.href} className="zk-card zk-metric" onClick={onClose}>
        {inner}
      </Link>
    ) : (
      <div className="zk-card zk-metric">{inner}</div>
    );
  }
  if (card.kind === "record") {
    return (
      <Link href={card.href} className="zk-card zk-row" onClick={onClose}>
        <span className="zk-row-ico" aria-hidden="true">
          {card.entity === "property" || card.entity === "listing" ? <Building2 className="h-4 w-4" /> : <User className="h-4 w-4" />}
        </span>
        <span className="zk-row-text">
          <span className="zk-row-title">{card.title}</span>
          {card.subtitle ? <span className="zk-row-sub">{card.subtitle}</span> : null}
        </span>
        <ArrowRight className="zk-row-go h-4 w-4" aria-hidden="true" />
      </Link>
    );
  }
  if (card.kind === "nav") {
    return (
      <Link href={card.href} className="zk-card zk-row" onClick={onClose}>
        <span className="zk-row-ico" aria-hidden="true">
          <Compass className="h-4 w-4" />
        </span>
        <span className="zk-row-text">
          <span className="zk-row-title">{card.label}</span>
          {card.description ? <span className="zk-row-sub">{card.description}</span> : null}
        </span>
        <ArrowRight className="zk-row-go h-4 w-4" aria-hidden="true" />
      </Link>
    );
  }
  return (
    <div className="zk-card zk-help">
      <span className="zk-help-title">
        <BookOpen className="h-4 w-4" aria-hidden="true" /> {card.title}
      </span>
      <span className="zk-help-body">{card.body}</span>
      {card.href ? (
        <Link href={card.href} className="zk-help-link" onClick={onClose}>
          Sayfayı aç <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      ) : null}
    </div>
  );
}

function ActionView({ action, primary, onClose }: { action: ZekaAction; primary: boolean; onClose: () => void }) {
  const Icon = action.kind === "create" ? Plus : action.kind === "contact" ? Search : action.label.includes("Liste") ? BarChart3 : ArrowRight;
  return (
    <span className="zk-action">
      <Link href={action.href} className={`zk-btn${primary ? " is-primary" : ""}`} onClick={onClose}>
        <Icon className="h-4 w-4" aria-hidden="true" />
        {action.label}
      </Link>
      {action.confirm && primary ? <span className="zk-confirm">{action.confirm}</span> : null}
    </span>
  );
}
