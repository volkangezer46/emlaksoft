"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2, MessageSquareText } from "lucide-react";
import { PhoneInput } from "@/components/ui/phone-input";
import type { LeadFormCopy } from "@/lib/legal-copy";
import {
  buildFavoritesLeadPayload,
  favoritesLeadFormError,
  type FavoritesLeadItem,
} from "@/lib/vitrin-favorites-lead";

const inputCls =
  "w-full rounded-[var(--radius-card)] border border-line bg-surface px-3.5 py-3 text-sm text-ink-950 placeholder:text-text-faint outline-none transition focus:border-brand-300";

/**
 * "Bu ilanlar hakkında bilgi al" — favori ilanlarla birlikte ofise başvuru. Mevcut public aday ucuna
 * (`/api/leads/[token]`) gider: IP/token hız sınırı, sunucu honeypot'u ve KVKK açık rıza kanıtı (metin sürümü) orada
 * işlenir; KVKK metni diğer public aday formlarıyla aynı kaynaktan (`getLeadFormCopy`) gelir.
 */
export function FavoritesInquiryForm({
  token,
  copy,
  items,
}: {
  token: string;
  copy: LeadFormCopy;
  items: FavoritesLeadItem[];
}) {
  const [status, setStatus] = useState<"idle" | "loading" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [kvkkAccepted, setKvkkAccepted] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const form = {
      fullName: String(fd.get("full_name") ?? ""),
      phone: String(fd.get("phone") ?? ""),
      kvkk: fd.get("kvkk") != null,
      marketingOptIn: fd.get("marketing_opt_in") != null,
      website: String(fd.get("website") ?? ""),
    };

    // Honeypot — botlar gizli alanı doldurur; API'ye gitmeden sessizce "başarılı" göster (sunucu da ayrıca yutar).
    if (form.website.trim()) {
      setStatus("done");
      return;
    }
    const invalid = favoritesLeadFormError(form, items.length);
    if (invalid) {
      setError(invalid);
      return;
    }

    setStatus("loading");
    setError(null);
    try {
      const res = await fetch(`/api/leads/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildFavoritesLeadPayload(form, items, crypto.randomUUID())),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(json.error || "Gönderilemedi. Lütfen tekrar deneyin.");
        setStatus("idle");
        return;
      }
      setStatus("done");
    } catch {
      setError("Bağlantı hatası. Lütfen tekrar deneyin.");
      setStatus("idle");
    }
  }

  if (status === "done") {
    return (
      <div className="mt-8 rounded-[var(--radius-panel)] border border-mint-400/40 bg-mint-500/10 px-5 py-8 text-center">
        <CheckCircle2 className="mx-auto h-9 w-9 text-mint-600" />
        <p className="mt-3 text-sm font-bold text-ink-950">Talebiniz alındı</p>
        <p className="mt-1 text-xs text-text-muted">Danışmanımız favori ilanlarınızla ilgili en kısa sürede sizi arayacak.</p>
      </div>
    );
  }

  return (
    <section className="mt-8 rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
      <h2 className="flex items-center gap-2 font-display text-lg font-extrabold text-ink-950">
        <MessageSquareText className="h-5 w-5 text-brand-600" /> Bu ilanlar hakkında bilgi alın
      </h2>
      <p className="mt-1 text-xs text-text-muted">
        Favorilerinizdeki {items.length} ilan talebinize eklenir; danışmanımız sizi arar.
      </p>
      <form onSubmit={onSubmit} className="relative mt-4 space-y-3">
        <input
          type="text"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          className="absolute left-[-9999px] h-0 w-0 opacity-0"
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <input name="full_name" required aria-label="Ad soyad" autoComplete="name" placeholder="Ad soyad *" className={inputCls} />
          <div>
            <label htmlFor="fav-lead-phone" className="sr-only">Cep telefonu</label>
            <PhoneInput id="fav-lead-phone" name="phone" required className={inputCls} placeholder="Cep telefonu *" />
          </div>
        </div>

        <p className="px-1 text-xs leading-relaxed text-text-muted">
          {copy.notice}{" "}
          <Link href="/kvkk-aydinlatma" target="_blank" className="font-semibold text-brand-600 underline-offset-2 hover:underline">
            Aydınlatma metni
          </Link>
        </p>

        <label className="flex cursor-pointer items-start gap-2.5 rounded-[var(--radius-card)] border border-line px-3.5 py-3 text-xs leading-relaxed text-text-muted transition hover:border-brand-300">
          <input
            type="checkbox"
            name="kvkk"
            required
            checked={kvkkAccepted}
            onChange={(e) => setKvkkAccepted(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600"
          />
          <span>{copy.consent}</span>
        </label>

        {/* Ayrı, opsiyonel pazarlama izni: varsayılan işaretsiz; talebin gönderilmesi buna bağlı değildir. */}
        <label className="flex cursor-pointer items-start gap-2.5 rounded-[var(--radius-card)] border border-line px-3.5 py-3 text-xs leading-relaxed text-text-muted transition hover:border-brand-300">
          <input type="checkbox" name="marketing_opt_in" defaultChecked={false} className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600" />
          <span>{copy.marketing}</span>
        </label>

        {error && <p role="alert" className="text-sm font-medium text-danger-600">{error}</p>}

        <button
          type="submit"
          disabled={status === "loading" || !kvkkAccepted}
          className="inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius-card)] bg-brand-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-brand-700 disabled:opacity-60 sm:w-auto"
        >
          {status === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Bilgi talebi gönder
        </button>
      </form>
    </section>
  );
}
