"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BellRing, CheckCircle2, Loader2, SlidersHorizontal } from "lucide-react";
import { LazyCombobox } from "@/components/public/lazy-combobox";
import { PhoneInput } from "@/components/ui/phone-input";
import { createVitrinSavedSearch } from "@/app/actions/vitrin";
import { listPublicDistricts, type PublicGeoOption } from "@/app/actions/public-valuation";
import type { SavedSearchFilters } from "@/lib/vitrin/saved-search-filters";

const inputCls =
  "w-full rounded-[var(--radius-card)] border border-line bg-canvas px-3.5 py-2.5 text-sm text-ink-950 placeholder:text-text-faint outline-none transition focus:border-brand-400";

/**
 * Vitrin "Aramamı kaydet" kutusu: ziyaretçi kriter + telefon + KVKK onayı
 * bırakır; kayıt vitrin_saved_searches'e yazılır, ofise bildirim düşer ve
 * günlük cron (/api/cron/vitrin-eslesme) yeni yayına giren ilanlarla eşleşince
 * ofisi tekrar uyarır. Ziyaretçiye SMS gönderilmez — danışman arar.
 *
 * `initial`: listede uygulanan süzgeçler kutuya önceden dolar (ziyaretçi aynı kriteri ikinci kez girmez). Gelişmiş
 * süzgeçler (tür, mahalle, m², yaş, kat, eşyalı…) etiketleriyle gösterilir ve varsayılan olarak aramaya eklenir;
 * ziyaretçi tek dokunuşla çıkarabilir.
 */
export type SavedSearchInitial = {
  tx: "" | "satilik" | "kiralik";
  provinceId: string;
  districtId: string;
  minPrice: number | null;
  maxPrice: number | null;
  rooms: string;
  filters: SavedSearchFilters;
  filterLabels: string[];
};

export function SavedSearchBox({
  slug,
  provinces,
  roomOptions,
  initial,
}: {
  slug: string;
  provinces: PublicGeoOption[];
  roomOptions: string[];
  initial?: SavedSearchInitial;
}) {
  const initialProvince = initial?.provinceId && provinces.some((p) => p.id === initial.provinceId) ? initial.provinceId : "";
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [kvkkAccepted, setKvkkAccepted] = useState(false);
  const [districts, setDistricts] = useState<PublicGeoOption[]>([]);
  const [districtLoading, setDistrictLoading] = useState(Boolean(initialProvince));
  const [districtId, setDistrictId] = useState(initial?.districtId ?? "");
  const [keepFilters, setKeepFilters] = useState(true);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const filterLabels = initial?.filterLabels ?? [];

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  // Listede il seçiliyse ilçeler bir kez yüklenir (önceden dolan ilçe seçimi görünür olsun).
  useEffect(() => {
    if (!initialProvince) return;
    let alive = true;
    listPublicDistricts(initialProvince)
      .then((list) => {
        if (alive) setDistricts(list);
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive) setDistrictLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [initialProvince]);

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

    // Gizli girdi tarayici dogrulamasina girmez: il secimini elle zorunlu tut.
    if (!String(fd.get("province_id") ?? "")) {
      setError("Lütfen bir il seçin.");
      setStatus("error");
      return;
    }

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
        filters: keepFilters && filterLabels.length > 0 ? initial?.filters : undefined,
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
      <section className="mt-10 rounded-[var(--radius-panel)] border border-mint-500/30 bg-mint-500/8 px-5 py-10 text-center" role="status" aria-live="polite">
        <CheckCircle2 className="mx-auto h-10 w-10 text-mint-600" />
        <p className="mt-3 font-display text-lg font-extrabold text-ink-950">Aramanız kaydedildi</p>
        <p className="mt-1 text-sm text-text-muted">
          Kriterlerinize uygun yeni bir portföy yayına girdiğinde danışmanımız sizi arayacak.
        </p>
      </section>
    );
  }

  return (
    <section className="mt-10 rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)] sm:p-6">
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[var(--radius-card)] bg-brand-600/10 text-brand-600">
          <BellRing className="h-5 w-5" />
        </span>
        <div>
          <h2 className="font-display text-lg font-extrabold text-ink-950">Aramamı kaydet</h2>
          <p className="mt-0.5 text-xs text-text-muted">
            Kriterlerinizi bırakın; uygun yeni portföy yayına girdiğinde sizi arayalım.
          </p>
        </div>
      </div>

      <form onSubmit={onSubmit} className="mt-4 space-y-3" aria-busy={status === "loading"}>
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
          <div>
            <label htmlFor="saved-search-name" className="sr-only">Ad soyad (opsiyonel)</label>
            <input id="saved-search-name" name="name" autoComplete="name" placeholder="Ad soyad (opsiyonel)" className={inputCls} />
          </div>
          <div>
            <label htmlFor="saved-search-phone" className="sr-only">Cep telefonu</label>
            <PhoneInput id="saved-search-phone" name="phone" tone="light" required autoComplete="tel" aria-describedby="saved-search-consent" className={inputCls} placeholder="Cep telefonu (05XX XXX XX XX) *" />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <select id="saved-search-tx" name="tx_type" required defaultValue={initial?.tx ?? ""} className={inputCls} aria-label="İşlem türü">
            <option value="" disabled>İşlem türü *</option>
            <option value="satilik">Satılık</option>
            <option value="kiralik">Kiralık</option>
          </select>
          <LazyCombobox
            id="saved-search-province"
            name="province_id"
            aria-label="İl"
            placeholder="İl *"
            searchPlaceholder="İl ara…"
            emptyText="Eşleşen il yok"
            clearable={false}
            defaultValue={initialProvince}
            options={provinces.map((p) => ({ value: p.id, label: p.name }))}
            onValueChange={(v) => {
              setDistrictId("");
              void onProvinceChange(v);
            }}
            className={inputCls}
          />
          <LazyCombobox
            id="saved-search-district"
            name="district_id"
            aria-label="İlçe"
            placeholder={districtLoading ? "İlçeler yükleniyor…" : "İlçe (tümü)"}
            searchPlaceholder="İlçe ara…"
            emptyText="Eşleşen ilçe yok"
            disabled={districts.length === 0}
            value={districtId}
            onValueChange={setDistrictId}
            options={districts.map((d) => ({ value: d.id, label: d.name }))}
            className={inputCls}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <input id="saved-search-min-price" name="min_price" inputMode="numeric" defaultValue={initial?.minPrice != null ? String(initial.minPrice) : undefined} aria-label="Minimum fiyat" placeholder="Min fiyat ₺" className={inputCls} />
          <input id="saved-search-max-price" name="max_price" inputMode="numeric" defaultValue={initial?.maxPrice != null ? String(initial.maxPrice) : undefined} aria-label="Maksimum fiyat" placeholder="Max fiyat ₺" className={inputCls} />
          <select id="saved-search-rooms" name="rooms" defaultValue={initial?.rooms && roomOptions.includes(initial.rooms) ? initial.rooms : ""} className={inputCls} aria-label="Oda sayısı">
            <option value="">Oda (fark etmez)</option>
            {roomOptions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>

        {filterLabels.length > 0 ? (
          <label
            htmlFor="saved-search-extra"
            className="flex min-h-11 cursor-pointer items-start gap-2.5 rounded-[var(--radius-card)] border border-line bg-canvas px-3.5 py-3 text-xs leading-relaxed text-text-muted transition hover:border-brand-300"
          >
            <input
              id="saved-search-extra"
              type="checkbox"
              checked={keepFilters}
              onChange={(e) => setKeepFilters(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600"
            />
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 font-semibold text-ink-950">
                <SlidersHorizontal className="h-3.5 w-3.5 text-brand-600" aria-hidden="true" />
                Listedeki süzgeçleri de ekle
              </span>
              <span className="mt-1 flex flex-wrap gap-1.5">
                {filterLabels.map((l) => (
                  <span key={l} className="rounded-full bg-brand-600/10 px-2 py-0.5 font-semibold text-brand-700">
                    {l}
                  </span>
                ))}
              </span>
            </span>
          </label>
        ) : null}

        <label id="saved-search-consent" htmlFor="saved-search-kvkk" className="flex cursor-pointer items-start gap-2.5 rounded-[var(--radius-card)] border border-line bg-canvas px-3.5 py-3 text-xs leading-relaxed text-text-muted transition hover:border-brand-300">
          <input
            id="saved-search-kvkk"
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

        {error ? <p ref={errorRef} tabIndex={-1} role="alert" aria-live="assertive" className="text-sm font-medium text-danger-500">{error}</p> : null}

        <button
          type="submit"
          disabled={status === "loading" || !kvkkAccepted}
          className="btn-shine inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius-card)] bg-brand-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-brand-600/90 disabled:opacity-60 sm:w-auto"
        >
          {status === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />}
          Aramamı kaydet
        </button>
      </form>
    </section>
  );
}
