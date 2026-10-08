"use client";

import { buttonClass, ButtonLink } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowRight, BellOff, ChevronDown, ListPlus, X } from "lucide-react";
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
