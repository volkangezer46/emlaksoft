"use client";

import { useEffect, useState, useTransition } from "react";
import { Eye, EyeOff } from "lucide-react";
import { revealAdvisorPii } from "@/app/actions/advisor-profile";
import type { PiiField } from "@/lib/advisor/pii-messages";

const AUTO_HIDE_MS = 30_000;

/**
 * Maskeli kimlik değeri + denetimli "Göster". Açık değer yalnız bu tarayıcı belleğinde, 30 sn boyunca tutulur;
 * her gösterim sunucuda `advisor_pii.reveal` denetim kaydı yazar (değer yazılmaz). Yalnız ofis sahibi, genel müdür
 * ve kişinin kendisi bu bileşeni görür (sunucu da ayrıca doğrular).
 */
export function PiiReveal({
  profileId,
  field,
  masked,
  label,
}: {
  profileId: string;
  field: PiiField;
  masked: string;
  label: string;
}) {
  const [value, setValue] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (value === null) return;
    const timer = setTimeout(() => setValue(null), AUTO_HIDE_MS);
    return () => clearTimeout(timer);
  }, [value]);

  function reveal() {
    setError(null);
    startTransition(async () => {
      const res = await revealAdvisorPii(profileId, field);
      if (res.ok) setValue(res.value);
      else setError(res.error);
    });
  }

  return (
    <div className="mt-2 rounded-[var(--radius-control)] border border-line bg-canvas/60 px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0">
          <span className="text-xs text-text-muted">{label}: </span>
          <span className="numeric select-all font-semibold tracking-wide text-ink-950">{value ?? masked}</span>
        </span>
        {value === null ? (
          <button
            type="button"
            onClick={reveal}
            disabled={pending}
            className="focus-ring press inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-line px-2.5 py-1 text-xs font-semibold text-text-muted hover:border-brand-300 hover:text-brand-600 disabled:opacity-60"
          >
            <Eye className="h-3.5 w-3.5" aria-hidden /> {pending ? "Açılıyor…" : "Göster"}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setValue(null)}
            className="focus-ring press inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-line px-2.5 py-1 text-xs font-semibold text-text-muted hover:border-brand-300 hover:text-brand-600"
          >
            <EyeOff className="h-3.5 w-3.5" aria-hidden /> Gizle
          </button>
        )}
      </div>
      <p className="mt-1 text-xs text-text-faint">Her gösterim denetim kaydına yazılır; değer 30 saniye sonra kendiliğinden gizlenir.</p>
      {error ? <p role="alert" className="mt-1 text-xs font-medium text-danger-600">{error}</p> : null}
    </div>
  );
}
