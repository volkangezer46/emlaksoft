"use client";

import { buttonClass, ButtonLink } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowRight, BellOff, ChevronDown, ListPlus, MoreHorizontal, X } from "lucide-react";
import { acceptInsightAsTask, setInsightState } from "@/app/actions/insights";
import type { InsightDismissReason } from "@/lib/insights/types";

const SNOOZE: { label: string; days: number }[] = [
  { label: "Yarına", days: 1 },
  { label: "3 gün", days: 3 },
  { label: "1 hafta", days: 7 },
];
const DISMISS: { label: string; reason: InsightDismissReason }[] = [
  { label: "Yanlış öneri", reason: "yanlis" },
  { label: "Zaten yaptım", reason: "zaten_yaptim" },
  { label: "İlgisiz", reason: "ilgisiz" },
];

/** Kanonik ikincil düğme (dokunmatikte 44px: `touch:h-11`, Button boy ölçeği). */
const btn = buttonClass({ variant: "secondary" });

/** Küçük, bağımlılıksız açılır menü (details). Seçimde kapanır; Esc ile kapanır. */
function Menu({ label, icon, children, disabled }: { label: string; icon: React.ReactNode; children: (close: () => void) => React.ReactNode; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <details
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      className="relative"
      onKeyDown={(e) => {
        if (e.key === "Escape") close();
      }}
    >
      <summary className={`${btn} cursor-pointer list-none [&::-webkit-details-marker]:hidden ${disabled ? "pointer-events-none opacity-60" : ""}`} aria-haspopup="menu">
        {icon}
        {label}
        <ChevronDown className="h-3.5 w-3.5 text-text-muted" aria-hidden="true" />
      </summary>
      <ul role="menu" className="absolute left-0 top-full z-20 mt-1 min-w-40 rounded-[var(--radius-card)] border border-line bg-surface-raised p-1 shadow-[var(--elev-3)]">
        {children(close)}
      </ul>
    </details>
  );
}

function Item({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <li role="none">
      <button
        type="button"
        role="menuitem"
        onClick={onClick}
        className="focus-ring flex min-h-9 touch:min-h-11 w-full items-center rounded-[var(--radius-control)] px-3 text-left text-sm font-medium text-ink-950 hover:bg-surface-hover"
      >
        {children}
      </button>
    </li>
  );
}

/**
 * Odak içgörüsünün eylemleri: tek tıkla aç (href), "Göreve çevir", "Ertele ▾", "Yoksay ▾".
 * Hiçbir eylem içgörünün işini kendisi yapmaz (fiyat/mesaj/atama yok); durum sunucu eyleminde, RLS'li RPC ile değişir.
 */
export function InsightEylemleri({ id, href, openLabel = "Aç", canTask }: { id: string; href: string; openLabel?: string; canTask: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const run = (fn: () => Promise<{ ok?: boolean; error?: string }>, okText: string) => {
    setMsg(null);
    start(async () => {
      const r = await fn();
      if (r.error) setMsg({ ok: false, text: r.error });
      else {
        setMsg({ ok: true, text: okText });
        router.refresh();
      }
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <ButtonLink href={href} size="lg" iconRight={ArrowRight}>
          {openLabel}
        </ButtonLink>
        {canTask ? (
          <button type="button" className={btn} disabled={pending} onClick={() => run(() => acceptInsightAsTask(id), "Görev oluşturuldu.")}>
            <ListPlus className="h-4 w-4" aria-hidden="true" />
            Göreve çevir
          </button>
        ) : null}
        <Menu label="Ertele" icon={<BellOff className="h-4 w-4" aria-hidden="true" />} disabled={pending}>
          {(close) =>
            SNOOZE.map((s) => (
              <Item
                key={s.days}
                onClick={() => {
                  close();
                  run(() => setInsightState(id, "snoozed", { snoozeDays: s.days }), "Ertelendi.");
                }}
              >
                {s.label}
              </Item>
            ))
          }
        </Menu>
        <Menu label="Yoksay" icon={<X className="h-4 w-4" aria-hidden="true" />} disabled={pending}>
          {(close) =>
            DISMISS.map((d) => (
              <Item
                key={d.reason}
                onClick={() => {
                  close();
                  run(() => setInsightState(id, "dismissed", { reason: d.reason }), "Yoksayıldı.");
                }}
              >
                {d.label}
              </Item>
            ))
          }
        </Menu>
      </div>
      <p role="status" aria-live="polite" className={`min-h-4 text-xs ${msg?.ok ? "text-[var(--pm-success-text)]" : "text-[var(--pm-danger-text)]"}`}>
        {pending ? "İşleniyor…" : (msg?.text ?? "")}
      </p>
    </div>
  );
}

/**
 * Tek öneri için KISA eylemler (sahip panosu, plan 2.4: "Aç" ve "…"): tek birincil "Aç" + tek "…" menüsü
 * (Göreve çevir, ertele, yoksay). İşlevler `InsightEylemleri` ile aynı sunucu eylemleri.
 */
export function InsightEylemKisa({ id, href, canTask }: { id: string; href: string; canTask: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (fn: () => Promise<{ ok?: boolean; error?: string }>, okText: string) => {
    setOpen(false);
    setMsg(null);
    start(async () => {
      const r = await fn();
      if (r.error) setMsg({ ok: false, text: r.error });
      else {
        setMsg({ ok: true, text: okText });
        router.refresh();
      }
    });
  };
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <ButtonLink href={href} size="lg" iconRight={ArrowRight} className="h-11">
          Aç
        </ButtonLink>
        <details
          open={open}
          onToggle={(e) => setOpen(e.currentTarget.open)}
          className="relative"
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
          }}
        >
          <summary
            aria-label="Öneri için diğer seçenekler"
            aria-haspopup="menu"
            className={`${buttonClass({ variant: "secondary", size: "icon" })} h-11 w-11 cursor-pointer list-none [&::-webkit-details-marker]:hidden ${pending ? "pointer-events-none opacity-60" : ""}`}
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
          </summary>
          <ul role="menu" className="absolute left-0 top-full z-20 mt-1 min-w-48 rounded-[var(--radius-card)] border border-line bg-surface-raised p-1 shadow-[var(--elev-3)]">
            {canTask ? <Item onClick={() => run(() => acceptInsightAsTask(id), "Görev oluşturuldu.")}>Göreve çevir</Item> : null}
            <Item onClick={() => run(() => setInsightState(id, "snoozed", { snoozeDays: 1 }), "Ertelendi.")}>Yarına ertele</Item>
            <Item onClick={() => run(() => setInsightState(id, "snoozed", { snoozeDays: 7 }), "Ertelendi.")}>1 hafta ertele</Item>
            <Item onClick={() => run(() => setInsightState(id, "dismissed", { reason: "zaten_yaptim" }), "Kaldırıldı.")}>Zaten yaptım</Item>
            <Item onClick={() => run(() => setInsightState(id, "dismissed", { reason: "ilgisiz" }), "Kaldırıldı.")}>İlgisiz</Item>
          </ul>
        </details>
      </div>
      <p role="status" aria-live="polite" className={`min-h-4 text-xs ${msg?.ok ? "text-[var(--pm-success-text)]" : "text-[var(--pm-danger-text)]"}`}>
        {pending ? "İşleniyor…" : (msg?.text ?? "")}
      </p>
    </div>
  );
}
