"use client";

/* eslint-disable @next/next/no-img-element -- paylaşım önizlemesi <img> ile (harici/dinamik görsel) */
import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { CheckCircle2, Smartphone, Monitor, XCircle, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DESC_MAX, TITLE_MAX, descriptionVerdict, titleVerdict, type ChecklistItem } from "@/lib/seo/rules";
import type { SeoActionResult } from "@/app/actions/seo-admin";

export function SubmitButton({ children, variant = "primary", disabled }: { children: ReactNode; variant?: "primary" | "secondary" | "danger"; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} loading={pending} disabled={disabled}>
      {children}
    </Button>
  );
}

export function ResultNote({ res }: { res: SeoActionResult | null }) {
  if (!res) return null;
  if (res.error) {
    return (
      <p role="alert" className="rounded-[var(--radius-control)] bg-danger-500/8 px-3 py-2 text-sm font-medium text-danger-600">
        {res.error}
      </p>
    );
  }
  return (
    <p role="status" className="flex items-center gap-1.5 text-sm font-medium text-success-strong">
      <CheckCircle2 className="h-4 w-4" aria-hidden /> {res.message ?? "Kaydedildi."}
    </p>
  );
}

/** Sunucu action'ına bağlı form: sonucu gösterir, başarıda sayfa verisini tazeler. */
export function SeoForm({
  action,
  children,
  className,
  onDone,
}: {
  action: (fd: FormData) => Promise<SeoActionResult>;
  children: ReactNode;
  className?: string;
  onDone?: (res: SeoActionResult) => void;
}) {
  const router = useRouter();
  const [res, setRes] = useState<SeoActionResult | null>(null);
  return (
    <form
      className={cn("space-y-4", className)}
      action={async (fd) => {
        const r = await action(fd);
        setRes(r);
        onDone?.(r);
        if (r.ok) router.refresh();
      }}
    >
      {children}
      <ResultNote res={res} />
    </form>
  );
}

/** Kilitli (yetkisiz) bölümler için not. */
export function LockedNote({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-xs text-text-muted">{children}</p>
  );
}

/* ------------------------------ Önizlemeler ------------------------------ */

function Counter({ n, max, label }: { n: number; max: number; label: string }) {
  const over = n > max;
  return (
    <span className={cn("text-xs font-semibold tabular-nums", over ? "text-danger-600" : n === 0 ? "text-text-faint" : "text-success-strong")}>
      {label}: {n}/{max}
    </span>
  );
}

/** Google sonuç görünümü. Mobil/masaüstü anahtarı; başlık ve açıklama sayaçları. */
export function SerpPreview({ title, url, description }: { title: string; url: string; description: string }) {
  const [mobile, setMobile] = useState(false);
  const descMax = mobile ? 120 : DESC_MAX;
  const shownTitle = title.length > TITLE_MAX ? `${title.slice(0, TITLE_MAX - 1)}…` : title;
  const shownDesc = description.length > descMax ? `${description.slice(0, descMax - 1)}…` : description;
  const tv = titleVerdict(title);
  const dv = descriptionVerdict(description);
  let host = url;
  try {
    const u = new URL(url);
    host = `${u.host}${u.pathname === "/" ? "" : u.pathname.replace(/\//g, " › ")}`;
  } catch {
    /* ham adres */
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Arama sonucu önizlemesi</p>
        <div role="group" aria-label="Önizleme cihazı" className="inline-flex rounded-[var(--radius-control)] border border-line p-0.5">
          <button type="button" aria-pressed={!mobile} onClick={() => setMobile(false)} className={cn("focus-ring inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold", !mobile ? "bg-surface text-ink-950" : "text-text-muted")}>
            <Monitor className="h-3.5 w-3.5" aria-hidden /> Masaüstü
          </button>
          <button type="button" aria-pressed={mobile} onClick={() => setMobile(true)} className={cn("focus-ring inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold", mobile ? "bg-surface text-ink-950" : "text-text-muted")}>
            <Smartphone className="h-3.5 w-3.5" aria-hidden /> Mobil
          </button>
        </div>
      </div>
      {/* Google sonuç sayfası taklidi: renkler bilerek sabit (tema bağımsız), gerçek görünümü temsil eder. */}
      <div className={cn("rounded-[var(--radius-card)] border border-line bg-white p-4 text-left", mobile ? "max-w-sm" : "max-w-2xl")}>
        <p className="truncate text-xs text-neutral-600">{host}</p>
        <p className="mt-0.5 text-lg leading-snug text-blue-800">{shownTitle || "Başlık yok"}</p>
        <p className="mt-1 text-sm leading-snug text-neutral-700">{shownDesc || "Açıklama yok; arama motoru sayfadan rastgele bir parça seçer."}</p>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <Counter n={title.length} max={TITLE_MAX} label="Başlık" />
        <Counter n={description.length} max={DESC_MAX} label="Açıklama" />
      </div>
      {tv.verdict !== "ok" || dv.verdict !== "ok" ? (
        <ul className="space-y-0.5 text-xs text-text-muted">
          {tv.verdict !== "ok" ? <li>{tv.message}</li> : null}
          {dv.verdict !== "ok" ? <li>{dv.message}</li> : null}
        </ul>
      ) : null}
    </div>
  );
}

/** Sosyal paylaşım kartı (Open Graph / Twitter büyük görsel). */
export function SocialPreview({ title, description, image, host }: { title: string; description: string; image: string; host: string }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Sosyal paylaşım önizlemesi</p>
      <div className="max-w-md overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
        <div className="aspect-[1200/630] bg-canvas">
          {image ? <img src={image} alt="" className="h-full w-full object-cover" loading="lazy" /> : null}
        </div>
        <div className="space-y-0.5 border-t border-line px-3 py-2">
          <p className="truncate text-xs uppercase text-text-faint">{host}</p>
          <p className="truncate text-sm font-semibold text-ink-950">{title || "Başlık yok"}</p>
          <p className="line-clamp-2 text-xs text-text-muted">{description}</p>
        </div>
      </div>
    </div>
  );
}

/** Kural tabanlı geçti/kaldı listesi (sahte puan yok). */
export function Checklist({ items }: { items: ChecklistItem[] }) {
  return (
    <ul className="divide-y divide-line rounded-[var(--radius-card)] border border-line">
      {items.map((it) => (
        <li key={it.id} className="flex items-start gap-2.5 px-3 py-2.5">
          {it.verdict === "ok" ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success-strong" aria-hidden />
          ) : it.verdict === "warn" ? (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning-strong" aria-hidden />
          ) : (
            <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger-600" aria-hidden />
          )}
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink-950">
              {it.label}{" "}
              <span className="text-xs font-medium text-text-muted">· {it.verdict === "ok" ? "geçti" : it.verdict === "warn" ? "dikkat" : "kaldı"}</span>
            </p>
            <p className="text-xs text-text-muted">{it.detail}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
