"use client";

import { Button } from "@/components/ui/button";
import { useState, useTransition } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { BillingOpResult } from "@/app/actions/platform-billing";

/**
 * Satır içi onaylı işlem: düğme -> aynı satırda alanlar + "Onayla/Vazgeç" (popup yok).
 * Çift tıklama: gönderim sürerken düğmeler kilitli; sunucu tarafı da koşullu güncellemeyle idempotent.
 */
export function InlineOp({
  label,
  confirmLabel,
  tone = "default",
  hidden,
  action,
  children,
  hint,
  refreshAfter = true,
}: {
  label: string;
  confirmLabel: string;
  tone?: "default" | "danger";
  hidden: Record<string, string>;
  action: (fd: FormData) => Promise<BillingOpResult>;
  /** Onay satırındaki ek alanlar (name= öznitelikli input/select). */
  children?: ReactNode;
  hint?: string;
  /**
   * Başarıdan sonra router.refresh(). Eylem bulunduğu sayfanın yolunu zaten revalidatePath ile tazeliyorsa (sunucu eylemi
   * yanıtı güncel RSC'yi taşır) false verin: çift tazeleme ve ek RSC turu olmaz (SK6/B037).
   */
  refreshAfter?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const btnTone = tone === "danger" ? "border-danger-500/30 text-danger-600" : undefined;

  if (!open) {
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        <Button
          type="button"
          onClick={() => {
            setMsg(null);
            setOpen(true);
          }}
          variant="outline" size="sm" className={btnTone}
        >
          {label}
        </Button>
        {msg ? (
          <span role="status" className={`text-xs font-semibold ${msg.ok ? "text-mint-700" : "text-danger-600"}`}>
            {msg.text}
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <form
      className="flex w-full flex-wrap items-end gap-2 rounded-[var(--radius-card)] border border-line bg-canvas/60 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (pending) return;
        const fd = new FormData(e.currentTarget);
        for (const [k, v] of Object.entries(hidden)) fd.set(k, v);
        startTransition(async () => {
          const res = await action(fd);
          if (res.error) {
            setMsg({ ok: false, text: res.error });
            return;
          }
          setMsg({ ok: true, text: res.notice ?? "İşlem kaydedildi." });
          setOpen(false);
          if (refreshAfter) router.refresh();
        });
      }}
    >
      {children}
      {hint ? <p className="w-full text-xs text-text-faint">{hint}</p> : null}
      {msg && !msg.ok ? (
        <p role="alert" className="w-full text-xs font-semibold text-danger-600">
          {msg.text}
        </p>
      ) : null}
      <Button
        type="submit"
        disabled={pending}
        variant="outline" size="sm" className={btnTone}
      >
        {pending ? "İşleniyor…" : confirmLabel}
      </Button>
      <Button variant="ghost" size="sm" type="button" disabled={pending} onClick={() => setOpen(false)}>
        Vazgeç
      </Button>
    </form>
  );
}

export const opFieldClass =
  "rounded-[var(--radius-control)] border border-line bg-surface px-2.5 py-1.5 text-xs text-ink-950 outline-none focus:border-brand-400";
