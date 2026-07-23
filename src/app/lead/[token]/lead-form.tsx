"use client";

import { useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";

type Province = { id: string; name: string };

const inputCls =
  "w-full rounded-[12px] border border-white/12 bg-white/[0.04] px-3.5 py-3 text-sm text-white placeholder:text-white/35 outline-none transition focus:border-mint-400/50 focus:bg-white/[0.07]";

export function LeadForm({ token, provinces }: { token: string; provinces: Province[] }) {
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("loading");
    setError(null);

    const fd = new FormData(e.currentTarget);
    const payload = Object.fromEntries(fd.entries());

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
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-3">
      <input name="full_name" required placeholder="Ad soyad *" className={inputCls} />
      <input name="phone" inputMode="tel" placeholder="Cep telefonu (05XX XXX XX XX)" className={inputCls} />
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

      {error && <p className="text-sm font-medium text-danger-300">{error}</p>}

      <button
        type="submit"
        disabled={status === "loading"}
        className="btn-shine inline-flex w-full items-center justify-center gap-2 rounded-[12px] bg-white px-4 py-3.5 text-sm font-bold text-ink-950 transition hover:bg-white/90 disabled:opacity-60"
      >
        {status === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Talebimi gönder
      </button>
      <p className="text-center text-[11px] text-white/35">
        Göndererek iletişim bilgilerinizin danışmanlık amacıyla işlenmesini kabul edersiniz.
      </p>
    </form>
  );
}
