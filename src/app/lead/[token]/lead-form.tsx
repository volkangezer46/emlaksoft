"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Loader2 } from "lucide-react";
import { PhoneInput } from "@/components/ui/phone-input";
import { EmailInput } from "@/components/ui/email-input";
import { DEFAULT_LEAD_FORM_COPY, type LeadFormCopy } from "@/lib/legal-copy";
import { QR_SOURCE_PARAM, parseUrlSource } from "@/lib/qr-source";
import { fieldClass } from "@/components/ui/form-controls";

type Province = { id: string; name: string };

// Public yüzey her zaman açık temada: panel form alanıyla aynı token'lar (koyu degrade kaldırıldı, COM-13).
const inputCls = `${fieldClass} min-h-11 text-base sm:text-sm`;
const checkCls =
  "flex cursor-pointer items-start gap-2.5 rounded-[var(--radius-card)] border border-line bg-canvas px-3.5 py-3 text-xs leading-relaxed text-text-muted transition hover:border-[color:var(--pb-edge)]";

export function LeadForm({
  token,
  provinces,
  vitrinSlug,
  copy = DEFAULT_LEAD_FORM_COPY,
  listingRef = null,
}: {
  token: string;
  provinces: Province[];
  vitrinSlug?: string | null;
  /** Sunucudan gelen yasal metinler (yönetim: /admin/ayarlar/yasal). */
  copy?: LeadFormCopy;
  /** Sunucuda doğrulanmış ilan kimliği (sayfadaki ilan kartı); talep bu portföye bağlanır. */
  listingRef?: string | null;
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

    setStatus("loading");
    setError(null);

    const query = new URLSearchParams(window.location.search);
    try {
      const res = await fetch(`/api/leads/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          request_id: crypto.randomUUID(),
          channel: "web_form",
          // QR'lı tabela/broşürden gelindiyse (`?kaynak=qr`) kaynak raporunda "QR tabela" olarak ayrışır.
          // Gönderim anında okunur: vitrin sayfası önbellekli (ISR) kalır, searchParams sunucuya taşınmaz.
          source: parseUrlSource(query.get(QR_SOURCE_PARAM)) ?? "web_form",
          // Kampanya izi (utm) ve ilan bağlamı: sunucu sınırlar/doğrular (lib/lead-utm.ts, lib/lead-listing.ts).
          utm_source: query.get("utm_source") ?? undefined,
          utm_campaign: query.get("utm_campaign") ?? undefined,
          ilan: listingRef ?? undefined,
        }),
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
      <div className="rounded-[var(--radius-card)] border border-mint-500/30 bg-mint-500/8 px-4 py-8 text-center" role="status">
        <CheckCircle2 className="mx-auto h-10 w-10 text-mint-600" aria-hidden="true" />
        <p className="mt-3 text-base font-bold text-ink-950">Talebiniz alındı</p>
        <p className="mt-1 text-sm text-text-muted">Danışmanımız en kısa sürede sizi arayacak.</p>
        {vitrinSlug ? (
          <Link
            href={`/vitrin/${vitrinSlug}`}
            className="focus-ring mt-5 inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-bold transition"
            style={{ borderColor: "var(--pb-edge)", backgroundColor: "var(--pb-veil)", color: "var(--pb-ink)" }}
          >
            Yayındaki portföyleri inceleyin <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        ) : null}
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      {/* Honeypot — gerçek kullanıcılar görmez; botlar doldurursa talep sessizce reddedilir */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="absolute left-[-9999px] h-0 w-0 opacity-0"
      />
      <input name="full_name" required aria-label="Ad soyad" autoComplete="name" placeholder="Ad soyad *" className={inputCls} />
      <label htmlFor="lead-phone" className="sr-only">Cep telefonu</label>
      <PhoneInput id="lead-phone" name="phone" className={inputCls} placeholder="Cep telefonu (05XX XXX XX XX)" />
      <EmailInput name="email" aria-label="E-posta" placeholder="E-posta (opsiyonel)" className={inputCls} />

      <div className="grid grid-cols-2 gap-3">
        <select name="transaction_type" aria-label="İşlem türü" defaultValue="" className={inputCls}>
          <option value="">İşlem türü</option>
          <option value="satilik">Satılık</option>
          <option value="kiralik">Kiralık</option>
        </select>
        <select name="property_type" aria-label="Mülk türü" defaultValue="" className={inputCls}>
          <option value="">Mülk türü</option>
          <option value="daire">Daire</option>
          <option value="villa">Villa</option>
          <option value="isyeri">İş yeri</option>
          <option value="arsa">Arsa</option>
        </select>
      </div>

      <select name="province_id" aria-label="İl" defaultValue="" className={inputCls}>
        <option value="">İl (opsiyonel)</option>
        {provinces.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>

      <div className="grid grid-cols-2 gap-3">
        <input name="budget_min" aria-label="Minimum bütçe (₺)" inputMode="numeric" placeholder="Min bütçe ₺" className={inputCls} />
        <input name="budget_max" aria-label="Maksimum bütçe (₺)" inputMode="numeric" placeholder="Max bütçe ₺" className={inputCls} />
      </div>

      <textarea name="message" aria-label="Aradığınız mülk" rows={3} placeholder="Aradığınız mülkü kısaca anlatın (opsiyonel)" className={inputCls} />

      <p className="px-1 text-xs leading-relaxed text-text-muted">
        {copy.notice}{" "}
        <Link href="/kvkk-aydinlatma" target="_blank" className="font-semibold underline-offset-2 hover:underline" style={{ color: "var(--pb-ink)" }}>
          Aydınlatma metni
        </Link>
      </p>

      <label className={checkCls}>
        <input
          type="checkbox"
          name="kvkk"
          required
          checked={kvkkAccepted}
          onChange={(e) => setKvkkAccepted(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0"
          style={{ accentColor: "var(--pb-brand)" }}
        />
        <span>{copy.consent}</span>
      </label>

      {/* Ayrı, opsiyonel pazarlama izni: varsayılan işaretsiz; talebin gönderilmesi buna bağlı değildir. */}
      <label className={checkCls}>
        <input type="checkbox" name="marketing_opt_in" defaultChecked={false} className="mt-0.5 h-4 w-4 shrink-0" style={{ accentColor: "var(--pb-brand)" }} />
        <span>{copy.marketing}</span>
      </label>

      {error && <p role="alert" className="text-sm font-medium text-danger-600">{error}</p>}

      {/* Birincil eylem ofisin marka renginde; metin rengi kontrast ölçülerek seçilir (brandTheme). */}
      <button
        type="submit"
        disabled={status === "loading" || !kvkkAccepted}
        className="btn-shine focus-ring press inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[var(--radius-card)] px-4 py-3.5 text-sm font-bold transition hover:opacity-95 disabled:opacity-60"
        style={{ backgroundColor: "var(--pb-brand)", color: "var(--pb-on-brand)" }}
      >
        {status === "loading" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
        Talebimi gönder
      </button>
    </form>
  );
}
