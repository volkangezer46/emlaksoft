"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Home, Loader2, PhoneCall, RefreshCw } from "lucide-react";
import { PhoneInput } from "@/components/ui/phone-input";
import {
  estimatePublicValuation,
  listPublicDistricts,
  submitValuationLead,
  type PublicGeoOption,
} from "@/app/actions/public-valuation";

/**
 * "Evim ne kadar eder?" hunisi — 3 adım:
 *  1) kriter formu  2) tahmini aralık (veya dürüst "veri yok")  3) ad+telefon → lead.
 * Görsel dil vitrin lead formuyla birebir (koyu tema).
 */

const inputCls =
  "w-full rounded-[12px] border border-white/12 bg-white/[0.04] px-3.5 py-3 text-sm text-white placeholder:text-white/35 outline-none transition focus:border-mint-400/50 focus:bg-white/[0.07]";

const ROOM_OPTIONS = ["1+0", "1+1", "2+1", "3+1", "4+1", "5+1 ve üzeri"];
const AGE_OPTIONS = ["0 (yeni)", "1-5", "6-10", "11-20", "21 ve üzeri"];

const money = (n: number) => new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(n) + " ₺";

type Estimate = { sufficient: false } | { sufficient: true; low: number; high: number; note: string };

export function ValuationFunnel({
  slug,
  provinces,
  propertyTypes,
  leadEnabled,
}: {
  slug: string;
  provinces: PublicGeoOption[];
  propertyTypes: string[];
  leadEnabled: boolean;
}) {
  const [step, setStep] = useState<"form" | "result" | "done">("form");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Kriterler — sonuç ve lead adımında da lazım
  const [provinceId, setProvinceId] = useState("");
  const [districtId, setDistrictId] = useState("");
  const [propertyType, setPropertyType] = useState(propertyTypes[0] ?? "Daire");
  const [sqm, setSqm] = useState("");
  const [rooms, setRooms] = useState("");
  const [buildingAge, setBuildingAge] = useState("");
  const [kvkk, setKvkk] = useState(false);
  const [honeypot, setHoneypot] = useState("");

  const [districts, setDistricts] = useState<PublicGeoOption[]>([]);
  const [loadingDistricts, startDistricts] = useTransition();

  const [estimate, setEstimate] = useState<Estimate | null>(null);

  // Lead adımı
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [leadError, setLeadError] = useState<string | null>(null);
  const [leadPending, setLeadPending] = useState(false);

  useEffect(() => {
    if (!provinceId) return;
    let stale = false;
    startDistricts(async () => {
      const rows = await listPublicDistricts(provinceId);
      if (!stale) setDistricts(rows);
    });
    return () => {
      stale = true;
    };
  }, [provinceId]);

  async function onEstimate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await estimatePublicValuation({
        slug,
        provinceId,
        districtId,
        propertyType,
        sqm: Number(sqm.replace(",", ".")),
        rooms,
        buildingAge,
        kvkk,
        website: honeypot,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setEstimate(res.sufficient ? { sufficient: true, low: res.low, high: res.high, note: res.note } : { sufficient: false });
      setStep("result");
    } catch {
      setError("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      setPending(false);
    }
  }

  async function onLead(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLeadError(null);
    setLeadPending(true);
    try {
      const res = await submitValuationLead({
        slug,
        fullName,
        phone,
        provinceId,
        districtId,
        propertyType,
        sqm: Number(sqm.replace(",", ".")),
        rooms,
        buildingAge,
        low: estimate?.sufficient ? estimate.low : null,
        high: estimate?.sufficient ? estimate.high : null,
        website: honeypot,
      });
      if (!res.ok) {
        setLeadError(res.error);
        return;
      }
      setStep("done");
    } catch {
      setLeadError("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      setLeadPending(false);
    }
  }

  // ---- 3. adım: teşekkür ----------------------------------------------------
  if (step === "done") {
    return (
      <div className="rounded-[16px] border border-mint-400/25 bg-mint-500/10 px-4 py-10 text-center">
        <CheckCircle2 className="mx-auto h-10 w-10 text-mint-400" />
        <p className="mt-3 text-base font-bold text-white">Talebiniz alındı</p>
        <p className="mt-1 text-sm text-white/60">
          Danışmanımız net değerleme için en kısa sürede sizi arayacak.
        </p>
        <Link
          href={`/vitrin/${slug}`}
          className="mt-5 inline-flex items-center gap-1.5 rounded-full border border-mint-400/30 bg-mint-500/10 px-4 py-2 text-xs font-bold text-mint-300 transition hover:bg-mint-500/20"
        >
          Yayındaki portföyleri inceleyin <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    );
  }

  // ---- 2. adım: sonuç + lead formu ------------------------------------------
  if (step === "result" && estimate) {
    return (
      <div className="space-y-5">
        {estimate.sufficient ? (
          <div className="rounded-[16px] border border-mint-400/25 bg-mint-500/10 px-5 py-6 text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-mint-400">
              Tahmini değer aralığı
            </p>
            <p className="mt-2 font-display text-2xl font-extrabold text-white sm:text-3xl">
              {money(estimate.low)} – {money(estimate.high)}
            </p>
            <p className="mt-2 text-xs text-white/50">{estimate.note}</p>
            <p className="mt-3 rounded-[10px] border border-white/10 bg-white/5 px-3 py-2 text-[11px] leading-relaxed text-white/55">
              Bu bir <strong className="text-white/80">ön tahmindir</strong>; resmi değerleme raporu yerine
              geçmez. Net değer, mülkün yerinde incelenmesiyle belirlenir.
            </p>
          </div>
        ) : (
          <div className="rounded-[16px] border border-white/12 bg-white/[0.04] px-5 py-6 text-center">
            <Home className="mx-auto h-8 w-8 text-white/40" />
            <p className="mt-3 text-base font-bold text-white">Bu bölge için yeterli veri yok</p>
            <p className="mt-1 text-sm text-white/60">
              Otomatik tahmin üretemedik — danışmanımız sizi arayıp mülkünüzü ücretsiz değerlendirsin.
            </p>
          </div>
        )}

        {leadEnabled ? (
          <form onSubmit={onLead} className="space-y-3">
            <p className="flex items-center gap-2 text-sm font-bold text-white">
              <PhoneCall className="h-4 w-4 text-mint-400" /> Net değerleme için danışmanımız arasın
            </p>
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              placeholder="Ad soyad *"
              className={inputCls}
            />
            <PhoneInput
              value={phone}
              onValueChange={setPhone}
              required
              className={inputCls}
              placeholder="Cep telefonu (05XX XXX XX XX)"
            />
            {leadError && <p className="text-sm font-medium text-danger-300">{leadError}</p>}
            <button
              type="submit"
              disabled={leadPending}
              className="btn-shine inline-flex w-full items-center justify-center gap-2 rounded-[12px] bg-white px-4 py-3.5 text-sm font-bold text-ink-950 transition hover:bg-white/90 disabled:opacity-60"
            >
              {leadPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Beni arayın
            </button>
          </form>
        ) : (
          <p className="rounded-[12px] border border-white/10 bg-white/5 px-4 py-4 text-center text-sm text-white/60">
            Talep formu şu anda kapalı — vitrindeki iletişim bilgilerinden ofise ulaşabilirsiniz.
          </p>
        )}

        <button
          type="button"
          onClick={() => {
            setStep("form");
            setEstimate(null);
          }}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-white/50 underline-offset-2 transition hover:text-white hover:underline"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Farklı kriterlerle tekrar hesapla
        </button>
      </div>
    );
  }

  // ---- 1. adım: kriter formu -------------------------------------------------
  return (
    <form onSubmit={onEstimate} className="space-y-3">
      {/* Honeypot — gerçek kullanıcılar görmez */}
      <input
        type="text"
        name="website"
        value={honeypot}
        onChange={(e) => setHoneypot(e.target.value)}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="absolute left-[-9999px] h-0 w-0 opacity-0"
      />

      <div className="grid grid-cols-2 gap-3">
        <select
          value={provinceId}
          onChange={(e) => {
            setProvinceId(e.target.value);
            setDistrictId("");
            setDistricts([]);
          }}
          required
          className={inputCls}
          aria-label="İl"
        >
          <option value="" className="bg-ink-950">İl seçin *</option>
          {provinces.map((p) => (
            <option key={p.id} value={p.id} className="bg-ink-950">
              {p.name}
            </option>
          ))}
        </select>
        <select
          value={districtId}
          onChange={(e) => setDistrictId(e.target.value)}
          required
          disabled={!provinceId}
          className={`${inputCls} disabled:opacity-50`}
          aria-label="İlçe"
        >
          <option value="" className="bg-ink-950">
            {loadingDistricts ? "Yükleniyor…" : provinceId ? "İlçe seçin *" : "Önce il seçin"}
          </option>
          {districts.map((d) => (
            <option key={d.id} value={d.id} className="bg-ink-950">
              {d.name}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <select
          value={propertyType}
          onChange={(e) => setPropertyType(e.target.value)}
          className={inputCls}
          aria-label="Mülk tipi"
        >
          {propertyTypes.map((t) => (
            <option key={t} value={t} className="bg-ink-950">
              {t}
            </option>
          ))}
        </select>
        <input
          value={sqm}
          onChange={(e) => setSqm(e.target.value)}
          required
          inputMode="numeric"
          placeholder="Brüt m² *"
          className={inputCls}
          aria-label="Brüt m²"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <select value={rooms} onChange={(e) => setRooms(e.target.value)} className={inputCls} aria-label="Oda sayısı">
          <option value="" className="bg-ink-950">Oda sayısı</option>
          {ROOM_OPTIONS.map((r) => (
            <option key={r} value={r} className="bg-ink-950">
              {r}
            </option>
          ))}
        </select>
        <select
          value={buildingAge}
          onChange={(e) => setBuildingAge(e.target.value)}
          className={inputCls}
          aria-label="Bina yaşı"
        >
          <option value="" className="bg-ink-950">Bina yaşı</option>
          {AGE_OPTIONS.map((a) => (
            <option key={a} value={a} className="bg-ink-950">
              {a}
            </option>
          ))}
        </select>
      </div>

      <label className="flex cursor-pointer items-start gap-2.5 rounded-[12px] border border-white/12 bg-white/[0.04] px-3.5 py-3 text-[12px] leading-relaxed text-white/60 transition hover:border-mint-400/40">
        <input
          type="checkbox"
          required
          checked={kvkk}
          onChange={(e) => setKvkk(e.target.checked)}
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
        disabled={pending || !kvkk}
        className="btn-shine inline-flex w-full items-center justify-center gap-2 rounded-[12px] bg-white px-4 py-3.5 text-sm font-bold text-ink-950 transition hover:bg-white/90 disabled:opacity-60"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Değerimi hesapla
      </button>
      <p className="text-center text-[11px] text-white/40">
        Sonuç bir ön tahmindir; resmi değerleme raporu yerine geçmez.
      </p>
    </form>
  );
}
