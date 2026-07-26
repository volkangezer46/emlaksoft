"use client";

import { useState } from "react";
import Link from "next/link";
import { BellRing, CheckCircle2, Loader2 } from "lucide-react";
import { PhoneInput } from "@/components/ui/phone-input";
import { createVitrinSavedSearch } from "@/app/actions/vitrin";
import { listPublicDistricts, type PublicGeoOption } from "@/app/actions/public-valuation";

const inputCls =
  "w-full rounded-[12px] border border-line bg-canvas px-3.5 py-2.5 text-sm text-ink-950 placeholder:text-text-faint outline-none transition focus:border-brand-400";

/**
 * Vitrin "Aramamı kaydet" kutusu: ziyaretçi kriter + telefon + KVKK onayı
 * bırakır; kayıt vitrin_saved_searches'e yazılır, ofise bildirim düşer ve
 * günlük cron (/api/cron/vitrin-eslesme) yeni yayına giren ilanlarla eşleşince
 * ofisi tekrar uyarır. Ziyaretçiye SMS gönderilmez — danışman arar.
 */
export function SavedSearchBox({
  slug,
  provinces,
  roomOptions,
}: {
  slug: string;
  provinces: PublicGeoOption[];
  roomOptions: string[];
}) {
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [kvkkAccepted, setKvkkAccepted] = useState(false);
  const [districts, setDistricts] = useState<PublicGeoOption[]>([]);
  const [districtLoading, setDistrictLoading] = useState(false);

  async function onProvinceChange(provinceId: string) {
    setDistricts([]);
    if (!provinceId) return;
    setDistrictLoading(true);
    try {
      setDistricts(await listPublicDistricts(provinceId));
    } finally {
      setDistrictLoading(false);
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);

    setStatus("loading");
    setError(null);
    try {
      const result = await createVitrinSavedSearch({
        slug,
        name: String(fd.get("name") ?? ""),
        phone: String(fd.get("phone") ?? ""),
        txType: String(fd.get("tx_type") ?? ""),
        provinceId: String(fd.get("province_id") ?? ""),
        districtId: String(fd.get("district_id") ?? "") || undefined,
        minPrice: String(fd.get("min_price") ?? "") || undefined,
        maxPrice: String(fd.get("max_price") ?? "") || undefined,
        rooms: String(fd.get("rooms") ?? "") || undefined,
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
      <section className="mt-10 rounded-[20px] border border-mint-500/30 bg-mint-500/8 px-5 py-10 text-center">
        <CheckCircle2 className="mx-auto h-10 w-10 text-mint-600" />
        <p className="mt-3 font-display text-lg font-extrabold text-ink-950">Aramanız kaydedildi</p>
        <p className="mt-1 text-sm text-text-muted">
          Kriterlerinize uygun yeni bir portföy yayına girdiğinde danışmanımız sizi arayacak.
        </p>
      </section>
    );
  }

  return (
    <section className="mt-10 rounded-[20px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)] sm:p-6">
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[13px] bg-brand-600/10 text-brand-600">
          <BellRing className="h-5 w-5" />
        </span>
        <div>
          <h2 className="font-display text-lg font-extrabold text-ink-950">Aramamı kaydet</h2>
          <p className="mt-0.5 text-xs text-text-muted">
            Kriterlerinizi bırakın; uygun yeni portföy yayına girdiğinde sizi arayalım.
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

        <div className="grid gap-3 sm:grid-cols-3">
          <select name="tx_type" required defaultValue="" className={inputCls} aria-label="İşlem türü">
            <option value="" disabled>İşlem türü *</option>
            <option value="satilik">Satılık</option>
            <option value="kiralik">Kiralık</option>
          </select>
          <select
            name="province_id"
            required
            defaultValue=""
            onChange={(e) => onProvinceChange(e.target.value)}
            className={inputCls}
            aria-label="İl"
          >
            <option value="" disabled>İl *</option>
            {provinces.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select name="district_id" defaultValue="" className={inputCls} aria-label="İlçe">
            <option value="">{districtLoading ? "İlçeler yükleniyor…" : "İlçe (tümü)"}</option>
            {districts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <input name="min_price" inputMode="numeric" placeholder="Min fiyat ₺" className={inputCls} />
          <input name="max_price" inputMode="numeric" placeholder="Max fiyat ₺" className={inputCls} />
          <select name="rooms" defaultValue="" className={inputCls} aria-label="Oda sayısı">
            <option value="">Oda (fark etmez)</option>
            {roomOptions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
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
            Kişisel verilerimin uygun portföy bildirimi amacıyla işlenmesine onay veriyorum.{" "}
            <Link href="/kvkk-aydinlatma" target="_blank" className="font-semibold text-brand-600 underline-offset-2 hover:underline">
              Aydınlatma metni
            </Link>
          </span>
        </label>

        {error ? <p className="text-sm font-medium text-danger-500">{error}</p> : null}

        <button
          type="submit"
          disabled={status === "loading" || !kvkkAccepted}
          className="btn-shine inline-flex w-full items-center justify-center gap-2 rounded-[12px] bg-brand-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-brand-600/90 disabled:opacity-60 sm:w-auto"
        >
          {status === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />}
          Aramamı kaydet
        </button>
      </form>
    </section>
  );
}
