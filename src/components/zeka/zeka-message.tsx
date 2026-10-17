"use client";

import { Fragment, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, BarChart3, BookOpen, Building2, Check, Compass, Copy, Plus, RotateCcw, Search, ThumbsDown, ThumbsUp, TriangleAlert, User } from "lucide-react";
import { parseZekaMarkdown, zekaPlainText, type ZekaInline } from "@/lib/ai/zeka/markdown";
import { formatTrTime } from "@/lib/clock";
import { ZEKA_LOW_CONFIDENCE, type ZekaAction, type ZekaCard, type ZekaResult } from "@/lib/ai/zeka/types";
import "./zeka.css";

/**
 * Zeka MESAJ bileşenleri — TEK uygulama: komut çubuğu yanıt paneli (`ZekaPanel`) ve sohbet penceresi (`ZekaDock`)
 * aynı yanıt gövdesini, kartları, eylemleri, güvenli markdown'ı, kopyala/oy araçlarını ve yazıyor göstergesini kullanır.
 * Markdown HTML üretmez (`markdown.ts` ağacı öğelerle çizilir); bağlantı yalnız site içi yola gider.
 */

const PHONE_MQ = "(max-width: 639.98px)";

export function useIsPhone(): boolean {
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

/** Asistan avatarı: lacivert-altın küre + kıvılcım (yalnız CSS animasyonu; azaltılmış harekette durağan). */
export function ZekaOrb({ size = "sm" }: { size?: "sm" | "md" | "lg" }) {
  return (
    <span className={`zk-orb is-${size}`} aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false">
        <path fill="currentColor" d="M10 2.5l1.7 4.9a3 3 0 0 0 1.9 1.9l4.9 1.7-4.9 1.7a3 3 0 0 0-1.9 1.9L10 19.5l-1.7-4.9a3 3 0 0 0-1.9-1.9L1.5 11l4.9-1.7a3 3 0 0 0 1.9-1.9z" />
        <path fill="currentColor" d="M19 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" />
      </svg>
    </span>
  );
}

/* ------------------------------- Güvenli markdown ------------------------------- */

function Inline({ nodes, onNavigate }: { nodes: ZekaInline[]; onNavigate?: () => void }) {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.t) {
          case "text":
            return <Fragment key={i}>{n.v}</Fragment>;
          case "br":
            return <br key={i} />;
          case "code":
            return <code key={i}>{n.v}</code>;
          case "bold":
            return (
              <strong key={i}>
                <Inline nodes={n.v} onNavigate={onNavigate} />
              </strong>
            );
          case "link":
            return (
              <Link key={i} href={n.href} onClick={onNavigate}>
                {n.v}
              </Link>
            );
        }
      })}
    </>
  );
}

export function ZekaMarkdown({ text, onNavigate, caret = false }: { text: string; onNavigate?: () => void; caret?: boolean }) {
  const blocks = parseZekaMarkdown(text);
  return (
    <div className={`zk-text${caret ? " is-streaming" : ""}`}>
      {blocks.map((b, i) =>
        b.t === "p" ? (
          <p key={i}>
            <Inline nodes={b.v} onNavigate={onNavigate} />
          </p>
        ) : b.t === "ul" ? (
          <ul key={i}>
            {b.items.map((it, j) => (
              <li key={j}>
                <Inline nodes={it} onNavigate={onNavigate} />
              </li>
            ))}
          </ul>
        ) : (
          <ol key={i} start={b.start}>
            {b.items.map((it, j) => (
              <li key={j}>
                <Inline nodes={it} onNavigate={onNavigate} />
              </li>
            ))}
          </ol>
        ),
      )}
    </div>
  );
}

/**
 * Yerel motorun yanıtı tek parça gelir: metin en çok 300 ms içinde akıcı biçimde açılır (yapay bekleme yok; azaltılmış
 * harekette anında). Açılış bitince `onDone` (kartlar/eylemler o anda belirir).
 */
function useReveal(text: string, animate: boolean): { shown: string; done: boolean } {
  const [count, setCount] = useState<number>(() => {
    if (!animate) return Number.POSITIVE_INFINITY;
    try {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? Number.POSITIVE_INFINITY : 0;
    } catch {
      return Number.POSITIVE_INFINITY;
    }
  });
  const len = text.length;
  useEffect(() => {
    if (count >= len) return;
    const duration = Math.min(300, 60 + len * 1.5);
    let start = 0;
    let raf = requestAnimationFrame(function step(t) {
      if (!start) start = t;
      const p = Math.min(1, (t - start) / duration);
      setCount(p >= 1 ? Number.POSITIVE_INFINITY : Math.ceil(len * (1 - (1 - p) ** 2)));
      if (p < 1) raf = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(raf);
    // Açılış yalnız ilk çizimde başlar; metin değişirse tam gösterilir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [len]);
  const done = count >= len;
  return { shown: done ? text : text.slice(0, count), done };
}

/* ------------------------------- Yanıt gövdesi ------------------------------- */

export type AnswerBodyProps = {
  result: ZekaResult;
  /** Görünen metin (akışta gelen; yoksa `result.answer`). */
  text?: string;
  /** Yerel yanıtın kısa açılışı. */
  reveal?: boolean;
  /** Devam soruları gösterilsin mi (sohbette yalnız son yanıtta). */
  followUps?: boolean;
  onFollow: (q: string) => void;
  onClose: () => void;
};

/** Bir yanıtın gövdesi (metin, notlar, kartlar, eylemler, devam soruları). Komut çubuğu paneli ve sohbet penceresi ORTAK. */
export function AnswerBody({ result, text, reveal = false, followUps = true, onFollow, onClose }: AnswerBodyProps) {
  const { shown, done } = useReveal(text ?? result.answer, reveal);
  const low = !result.answered || result.confidence < ZEKA_LOW_CONFIDENCE;
  return (
    <>
      <ZekaMarkdown text={shown} onNavigate={onClose} />
      {done ? (
        <div className="zk-after">
          {result.fallbackReason === "hata" ? <p className="zk-note">GPT şu an yanıt veremedi; bu yanıtı yerel zeka verdi.</p> : null}
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
          {followUps && result.followUps.length > 0 ? (
            <div className="zk-follow" role="group" aria-label="Devam soruları">
              {result.followUps.map((f) => (
                <button key={f} type="button" className="zk-chip" onClick={() => onFollow(f)}>
                  {f}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

/** Kopyala + beğen/beğenme + saat (yanıt başına). Oy yalnız günlük kaydı varsa (`logId`). */
export function MessageTools({ text, logId, voted, onVote, at }: { text: string; logId?: string; voted: 1 | -1 | null; onVote: (v: 1 | -1) => void; at?: number }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="zk-tools">
      <button
        type="button"
        className="zk-tool"
        aria-label={copied ? "Kopyalandı" : "Yanıtı kopyala"}
        title={copied ? "Kopyalandı" : "Kopyala"}
        onClick={() => {
          const plain = zekaPlainText(text);
          void navigator.clipboard?.writeText(plain).then(
            () => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            },
            () => undefined,
          );
        }}
      >
        {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
      </button>
      {logId ? (
        <>
          <button type="button" className="zk-tool" aria-pressed={voted === 1} aria-label="Yararlı" title="Yararlı" disabled={voted !== null} onClick={() => onVote(1)}>
            <ThumbsUp className="h-4 w-4" aria-hidden="true" />
          </button>
          <button type="button" className="zk-tool" aria-pressed={voted === -1} aria-label="Yararlı değil" title="Yararlı değil" disabled={voted !== null} onClick={() => onVote(-1)}>
            <ThumbsDown className="h-4 w-4" aria-hidden="true" />
          </button>
        </>
      ) : null}
      {voted ? <span className="zk-thanks">Teşekkürler</span> : null}
      {at ? <span className="zk-time">{formatTrTime(at)}</span> : null}
    </div>
  );
}

/** Üç nokta "yazıyor" göstergesi. */
export function TypingDots() {
  return (
    <span className="zk-typing" role="status" aria-label="Zeka yazıyor">
      <i />
      <i />
      <i />
    </span>
  );
}

/** Hata / sınır uyarısı (429 nazik metinle). */
export function ZekaNotice({ text, limited = false, children }: { text: string; limited?: boolean; children?: ReactNode }) {
  return (
    <div className={`zk-error${limited ? " is-limit" : ""}`} role={limited ? "status" : "alert"}>
      <p>
        <TriangleAlert className="h-4 w-4" aria-hidden="true" />
        <span>
          {text}
          {limited ? <span className="zk-error-sub">Sınır 24 saatte bir yenilenir; acil sorular için sayfaların kendi aramasını kullanabilirsiniz.</span> : null}
        </span>
      </p>
      {children}
    </div>
  );
}

export function RetryChip({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="zk-chip" onClick={onClick} disabled={disabled}>
      <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
      Tekrar dene
    </button>
  );
}

/* ------------------------------- Kartlar ve eylemler ------------------------------- */

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
  if (card.kind === "record" || card.kind === "nav") {
    const title = card.kind === "record" ? card.title : card.label;
    const sub = card.kind === "record" ? card.subtitle : card.description;
    const Icon = card.kind === "nav" ? Compass : card.entity === "property" || card.entity === "listing" ? Building2 : User;
    return (
      <Link href={card.href} className="zk-card zk-row" onClick={onClose}>
        <span className="zk-row-ico" aria-hidden="true">
          <Icon className="h-4 w-4" />
        </span>
        <span className="zk-row-text">
          <span className="zk-row-title">{title}</span>
          {sub ? <span className="zk-row-sub">{sub}</span> : null}
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
