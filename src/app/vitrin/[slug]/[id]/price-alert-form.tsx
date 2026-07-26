"use client";

import { useState } from "react";
import Link from "next/link";
import { BellRing, CheckCircle2, Loader2, TrendingDown } from "lucide-react";
import { PhoneInput } from "@/components/ui/phone-input";
import { createVitrinPriceAlert } from "@/app/actions/vitrin-alerts";

const inputCls =
  "w-full rounded-[12px] border border-line bg-canvas px-3.5 py-2.5 text-sm text-ink-950 placeholder:text-text-faint outline-none transition focus:border-brand-400";

/**
 * İlan detayı "Fiyat düşünce haber ver" mini formu — ad + telefon + KVKK.
 * Kayıt vitrin_price_alerts'e yazılır (baseline = şu anki liste fiyatı);
 * fiyat düşünce günlük cron OFİSİ uyarır, danışman ziyaretçiyi arar.
 * Ziyaretçiye SMS gönderilmez (İYS'siz akış).
 */
export function PriceAlertForm({ slug, propertyId }: { slug: string; propertyId: string }) {
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [kvkkAccepted, setKvkkAccepted] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setStatus("loading");
    setError(null);
    try {
      const result = await createVitrinPriceAlert({
        slug,
        propertyId,
        name: String(fd.get("name") ?? ""),
        phone: String(fd.get("phone") ?? ""),
        kvkk: kvkkAccepted,
        website: String(fd.get("website") ?? ""),
      });
      if (!result.ok) {
        setError(result.error);
        setStatus("error");
        return;
      }
      setStatus("done");
    } catch {
      setError("Bağlantı hatası. Lütfen tekrar deneyin.");
      setStatus("error");
    }
  }

  if (status === "done") {
    return (
      <div className="mt-5 rounded-[18px] border border-mint-500/30 bg-mint-500/8 px-5 py-8 text-center">
        <CheckCircle2 className="mx-auto h-8 w-8 text-mint-600" />
        <p className="mt-2 font-display text-base font-extrabold text-ink-950">Fiyat alarmı kuruldu</p>
        <p className="mt-1 text-xs text-text-muted">
          Bu portföyün fiyatı düştüğünde danışmanımız sizi arayarak haber verecek.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-5 rounded-[18px] border border-line bg-surface p-5">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-brand-600/10 text-brand-600">
          <TrendingDown className="h-5 w-5" />
        </span>
        <div>
          <h2 className="font-display text-base font-extrabold text-ink-950">Fiyat düşünce haber ver</h2>
          <p className="mt-0.5 text-xs text-text-muted">
            Bu ilanın fiyatı düşerse danışmanımız sizi arasın — SMS yok, tek arama.
          </p>
        </div>
      </div>

      <form onSubmit={onSubmit} className="mt-4 space-y-3">
        {/* Honeypot — gerçek kullanıcılar görmez; botlar doldurursa kayıt sessizce reddedilir */}
        <input
          type="text"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          className="absolute left-[-9999px] h-0 w-0 opacity-0"
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <input name="name" placeholder="Ad soyad (opsiyonel)" className={inputCls} />
          <PhoneInput name="phone" required className={inputCls} placeholder="Cep telefonu (05XX XXX XX XX) *" />
        </div>

        <label className="flex cursor-pointer items-start gap-2.5 rounded-[12px] border border-line bg-canvas px-3.5 py-3 text-[12px] leading-relaxed text-text-muted transition hover:border-brand-300">
          <input
            type="checkbox"
            name="kvkk"
            required
            checked={kvkkAccepted}
            onChange={(e) => setKvkkAccepted(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600"
          />
          <span>
            Kişisel verilerimin fiyat değişikliği bildirimi amacıyla işlenmesine onay veriyorum.{" "}
            <Link href="/kvkk-aydinlatma" target="_blank" className="font-semibold text-brand-600 underline-offset-2 hover:underline">
              Aydınlatma metni
            </Link>
          </span>
        </label>

        {error ? <p className="text-sm font-medium text-danger-500">{error}</p> : null}

        <button
          type="submit"
          disabled={status === "loading" || !kvkkAccepted}
          className="btn-shine inline-flex w-full items-center justify-center gap-2 rounded-[12px] bg-brand-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-brand-600/90 disabled:opacity-60"
        >
          {status === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />}
          Alarmı kur
        </button>
      </form>
    </div>
  );
}
