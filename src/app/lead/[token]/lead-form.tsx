"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Loader2 } from "lucide-react";
import { PhoneInput } from "@/components/ui/phone-input";

type Province = { id: string; name: string };

const inputCls =
  "w-full rounded-[12px] border border-white/12 bg-white/[0.04] px-3.5 py-3 text-sm text-white placeholder:text-white/35 outline-none transition focus:border-mint-400/50 focus:bg-white/[0.07]";

export function LeadForm({
  token,
  provinces,
  vitrinSlug,
}: {
  token: string;
  provinces: Province[];
  vitrinSlug?: string | null;
}) {
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [kvkkAccepted, setKvkkAccepted] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const fd = new FormData(e.currentTarget);
    const payload = Object.fromEntries(fd.entries());

    // Honeypot — botlar gizli alanı doldurur; API'ye gitmeden sessizce "başarılı" göster
    if (String(payload.website ?? "").trim()) {
      setStatus("done");
      return;
    }
    delete payload.website;
    delete payload.kvkk;

    setStatus("loading");
    setError(null);

    try {
      const res = await fetch(`/api/leads/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, channel: "web_form", source: "web_form" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || "Gönderilemedi. Lütfen tekrar deneyin.");
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
      <div className="mt-6 rounded-[16px] border border-mint-400/25 bg-mint-500/10 px-4 py-8 text-center">
        <CheckCircle2 className="mx-auto h-10 w-10 text-mint-400" />
        <p className="mt-3 text-base font-bold text-white">Talebiniz alındı</p>
        <p className="mt-1 text-sm text-white/60">Danışmanımız en kısa sürede sizi arayacak.</p>
        {vitrinSlug ? (
          <Link
            href={`/vitrin/${vitrinSlug}`}
            className="mt-5 inline-flex items-center gap-1.5 rounded-full border border-mint-400/30 bg-mint-500/10 px-4 py-2 text-xs font-bold text-mint-300 transition hover:bg-mint-500/20"
          >
            Yayındaki portföyleri inceleyin <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        ) : null}
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-3">
      {/* Honeypot — gerçek kullanıcılar görmez; botlar doldurursa talep sessizce reddedilir */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="absolute left-[-9999px] h-0 w-0 opacity-0"
      />
      <input name="full_name" required placeholder="Ad soyad *" className={inputCls} />
      <PhoneInput name="phone" className={inputCls} placeholder="Cep telefonu (05XX XXX XX XX)" />
      <input name="email" type="email" placeholder="E-posta (opsiyonel)" className={inputCls} />

      <div className="grid grid-cols-2 gap-3">
        <select name="transaction_type" defaultValue="" className={inputCls}>
          <option value="" className="bg-ink-950">İşlem türü</option>
          <option value="satilik" className="bg-ink-950">Satılık</option>
          <option value="kiralik" className="bg-ink-950">Kiralık</option>
        </select>
        <select name="property_type" defaultValue="" className={inputCls}>
          <option value="" className="bg-ink-950">Mülk türü</option>
          <option value="daire" className="bg-ink-950">Daire</option>
          <option value="villa" className="bg-ink-950">Villa</option>
          <option value="isyeri" className="bg-ink-950">İş yeri</option>
          <option value="arsa" className="bg-ink-950">Arsa</option>
        </select>
      </div>

      <select name="province_id" defaultValue="" className={inputCls}>
        <option value="" className="bg-ink-950">İl (opsiyonel)</option>
        {provinces.map((p) => (
          <option key={p.id} value={p.id} className="bg-ink-950">
            {p.name}
          </option>
        ))}
      </select>

      <div className="grid grid-cols-2 gap-3">
        <input name="budget_min" inputMode="numeric" placeholder="Min bütçe ₺" className={inputCls} />
        <input name="budget_max" inputMode="numeric" placeholder="Max bütçe ₺" className={inputCls} />
      </div>

      <textarea name="message" rows={3} placeholder="Aradığınız mülkü kısaca anlatın (opsiyonel)" className={inputCls} />

      <label className="flex cursor-pointer items-start gap-2.5 rounded-[12px] border border-white/12 bg-white/[0.04] px-3.5 py-3 text-[12px] leading-relaxed text-white/60 transition hover:border-mint-400/40">
        <input
          type="checkbox"
          name="kvkk"
          required
          checked={kvkkAccepted}
          onChange={(e) => setKvkkAccepted(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-mint-400"
        />
        <span>
          Kişisel verilerimin tanıtım amacıyla işlenmesine onay veriyorum.{" "}
          <Link href="/kvkk-aydinlatma" target="_blank" className="font-semibold text-mint-300 underline-offset-2 hover:underline">
            Aydınlatma metni
          </Link>
        </span>
      </label>

      {error && <p className="text-sm font-medium text-danger-300">{error}</p>}

      <button
        type="submit"
        disabled={status === "loading" || !kvkkAccepted}
        className="btn-shine inline-flex w-full items-center justify-center gap-2 rounded-[12px] bg-white px-4 py-3.5 text-sm font-bold text-ink-950 transition hover:bg-white/90 disabled:opacity-60"
      >
        {status === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Talebimi gönder
      </button>
    </form>
  );
}
