"use client";

import Link from "next/link";
import Image from "next/image";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  Palette,
  Rocket,
  Sparkles,
  Target,
  Upload,
  User,
  Users,
} from "lucide-react";
import { signUp, type AuthResult } from "@/app/actions/auth";
import { listDistricts, type GeoOption } from "@/app/actions/geo";
import { AuthShell } from "@/components/auth/auth-shell";
import { PasswordStrengthMeter } from "@/components/auth/password-strength";
import { GeoSelect } from "@/components/app/geo-select";
import { PhoneInput } from "@/components/ui/phone-input";
import { EmailInput } from "@/components/ui/email-input";
import { Progress } from "@/components/ui/progress";
import { formatNumberTr } from "@/lib/format";
import { efCreditsLine } from "@/lib/ef-credits/plan-credits";
import { efPlannedLine } from "@/lib/ef-credits/public-state-core";
import { PLANS, getPlan, type BillingCycle, type PlanDef, type PlanId } from "@/lib/billing/plans";
import { registrationQuote, registrationSelection, seatBounds } from "@/lib/billing/seat-calculator-model";
import {
  BRAND_COLOR_PRESETS,
  FIELD,
  FOCUS_SEGMENTS,
  MAX_INVITES,
  MAX_WORK_DISTRICTS,
  OFFICE_TYPES,
  parseBrandColor,
  type FocusSegment,
  type OfficeType,
} from "@/lib/sample-data/office-profile";

import { AttributionFields, type SignupAttributionFields } from "./attribution-fields";
import { InviteBanner, type InviteBannerData } from "./invite-banner";

const initial: AuthResult = {};

/** Sihirbaz adımları: her adım TEK soruya odaklanır. Tamamlananlara geri dönülebilir. */
const STEPS = [
  { no: 1, label: "Hesap", question: "Seni nasıl tanıyalım?", icon: User },
  { no: 2, label: "Ofis", question: "Ofisin nerede ve ne kadar büyük?", icon: Building2 },
  { no: 3, label: "Marka", question: "Panel senin renklerinde olsun", icon: Palette },
  { no: 4, label: "Odak", question: "Ne satıyorsun, nerede çalışıyorsun?", icon: Target },
  { no: 5, label: "Ekip", question: "Ekibini şimdi mi davet edelim?", icon: Users },
  { no: 6, label: "Başla", question: "Ofisin dolu mu gelsin, boş mu?", icon: Rocket },
] as const;
const LAST = STEPS.length;

/**
 * Sunucu hatasını ilgili adıma eşler — kullanıcı son adımda gönderir ama hata
 * 1. adımdaki e-posta/telefona ya da 2. adımdaki ofis bilgisine ait olabilir.
 */
function errorStep(message: string): 1 | 2 | null {
  if (message.includes("e-posta zaten") || message.includes("cep telefonu") || message.includes("Şifre")) return 1;
  if (message.includes("Ofis") || message.includes("firma")) return 2;
  return null;
}

const inputCls =
  "w-full rounded-[var(--radius-card)] border border-line bg-surface py-3 pl-10 pr-3.5 text-sm outline-none transition focus:border-brand-400 focus:ring-4 focus:ring-brand-600/10";
const plainInputCls =
  "w-full rounded-[var(--radius-card)] border border-line bg-surface px-3.5 py-3 text-sm outline-none transition focus:border-brand-400 focus:ring-4 focus:ring-brand-600/10";
const primaryBtn =
  "btn-shine group flex flex-1 items-center justify-center gap-2 rounded-[var(--radius-card)] bg-[image:var(--grad-brand)] px-4 py-3 text-sm font-semibold text-white shadow-[var(--shadow-glow-brand)] transition hover:brightness-[1.06] disabled:opacity-60";
const ghostBtn =
  "flex items-center justify-center gap-1.5 rounded-[var(--radius-card)] border border-line px-4 py-3 text-sm font-semibold text-text-muted transition hover:bg-surface";
const cardChoice = (active: boolean) =>
  `focus-within:ring-2 focus-within:ring-brand-400 flex cursor-pointer flex-col gap-0.5 rounded-[var(--radius-card)] border p-3 text-sm transition ${
    active ? "border-brand-600 bg-brand-600/[0.05] shadow-[var(--elev-2)]" : "border-line bg-surface hover:border-brand-300"
  }`;

export function RegisterForm({
  initialPlan = "office",
  initialCycle = "monthly",
  initialSeats,
  plans = PLANS,
  trialDays,
  offers,
  attribution,
  invite = null,
  efValuationCost,
  efLive = false,
  copy,
  provinces = [],
}: {
  /** Bir değerlemenin kontör bedeli (sunucuda tarifeden); "yaklaşık N değerleme" metni için. */
  efValuationCost?: number;
  /** EmlakFiyati canlı mı (tek durum kaynağı); değilse kontör satırı "(planlanan)" ve satın alma cümlesi yok. */
  efLive?: boolean;
  /** Üst metinler (Site içeriği, sunucuda değişkenleri çözülmüş düz metin); yoksa bugünkü metin. */
  copy?: { title: string; text: string; panelText: string };
  initialPlan?: PlanId;
  initialCycle?: BillingCycle;
  /** Fiyat sayfası hesaplayıcısından gelen kullanıcı sayısı; yoksa seçilen planın dahil kullanıcı sayısı. */
  initialSeats?: number;
  plans?: readonly PlanDef[];
  /** Gerçekte verilen deneme günü (sunucuda getEffectiveTrialDays); yoksa sayı yazılmaz. */
  trialDays?: number;
  /** Etkin aylık fiyat (kampanya dahil), plan kimliğine göre. */
  offers?: Record<string, { monthlyTry: number }>;
  attribution?: SignupAttributionFields;
  /** Davet bağlantısıyla gelen ziyaretçi için "X sizi davet etti" (program açık ve kod aktifse). */
  invite?: InviteBannerData | null;
  /** İl listesi (coğrafya tek merkez, sunucudan). */
  provinces?: GeoOption[];
}) {
  // Tek hesapta satılabilecek en yüksek kullanıcı sayısı katalogdan gelir (sabit yok).
  const MAX_SEATS_INPUT = seatBounds(plans).inputMax;
  const [state, action, pending] = useActionState(signUp, initial);
  const [step, setStep] = useState(1);
  const [showPassword, setShowPassword] = useState(false);
  const [pw, setPw] = useState("");
  const [seats, setSeats] = useState(() =>
    initialSeats && initialSeats > 0
      ? Math.min(MAX_SEATS_INPUT, Math.floor(initialSeats))
      : (plans.find((p) => p.id === initialPlan) ?? getPlan(initialPlan)).limits.seats,
  );
  const [seatsText, setSeatsText] = useState(String(seats));
  // Kullanıcı sayıyı değiştirene kadar fiyat sayfasından gelen bilinçli paket seçimi korunur.
  const [seatsTouched, setSeatsTouched] = useState(initialSeats !== undefined);
  const [officeType, setOfficeType] = useState<OfficeType>("bagimsiz");
  const [brandColor, setBrandColor] = useState<string>(BRAND_COLOR_PRESETS[0]!.hex);
  const [customHex, setCustomHex] = useState("");
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoName, setLogoName] = useState<string | null>(null);
  const [focus, setFocus] = useState<FocusSegment[]>(["satilik", "kiralik"]);
  const [provinceId, setProvinceId] = useState("");
  const [districts, setDistricts] = useState<GeoOption[]>([]);
  const [loadingDistricts, startDistricts] = useTransition();
  const [workDistricts, setWorkDistricts] = useState<string[]>([]);
  const [demo, setDemo] = useState(true);
  const stepRefs = [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)];
  const logoInputRef = useRef<HTMLInputElement>(null);

  const errorTargetStep = state.error ? errorStep(state.error) : null;
  // Paket önerisi fiyat sayfasındaki hesaplayıcıyla AYNI motordan gelir (sabit eşik yok).
  const selection = registrationSelection(plans, offers, seats, initialCycle, seatsTouched ? null : initialPlan);
  const selectedPlanId = selection.planId as PlanId;
  const selectedPlan = plans.find((p) => p.id === selectedPlanId) ?? getPlan(selectedPlanId);
  const quote = registrationQuote(plans, offers, selectedPlanId, seats, initialCycle);

  // Çalışılan ilçeler: ofis ili seçilince o ilin ilçeleri gelir (coğrafya tek merkez, aynı sunucu ucu).
  useEffect(() => {
    if (!provinceId) {
      setDistricts([]);
      return;
    }
    let stale = false;
    startDistricts(async () => {
      const rows = await listDistricts(provinceId);
      if (!stale) setDistricts(rows);
    });
    return () => {
      stale = true;
    };
  }, [provinceId]);

  // Sunucu hatası dönünce ilgili adıma dön (kullanıcı 6. adımda kalıp hatayı görmesin).
  useEffect(() => {
    if (errorTargetStep) setStep(errorTargetStep);
  }, [errorTargetStep, state]);

  function commitSeats(n: number) {
    const v = Math.min(MAX_SEATS_INPUT, Math.max(1, Math.floor(Number.isFinite(n) ? n : 1)));
    setSeats(v);
    setSeatsText(String(v));
    setSeatsTouched(true);
  }

  function validateStep(ref: React.RefObject<HTMLDivElement | null>) {
    const inputs = ref.current?.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input, select");
    if (!inputs) return true;
    for (const el of Array.from(inputs)) {
      if (!el.reportValidity()) return false;
    }
    return true;
  }

  function next() {
    const ref = stepRefs[step - 1];
    if (ref && !validateStep(ref)) return;
    setStep((s) => Math.min(s + 1, LAST));
  }
  function back() {
    setStep((s) => Math.max(1, s - 1));
  }

  function handleLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) {
      setLogoPreview(null);
      setLogoName(null);
      return;
    }
    setLogoName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => setLogoPreview(typeof ev.target?.result === "string" ? ev.target.result : null);
    reader.readAsDataURL(file);
  }
  function clearLogo() {
    if (logoInputRef.current) logoInputRef.current.value = "";
    setLogoPreview(null);
    setLogoName(null);
  }

  function toggleFocus(key: FocusSegment) {
    setFocus((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));
  }
  function toggleDistrict(id: string) {
    setWorkDistricts((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id);
      if (cur.length >= MAX_WORK_DISTRICTS) return cur;
      return [...cur, id];
    });
  }

  const effectiveHex = parseBrandColor(customHex) ?? brandColor;
  const current = STEPS[step - 1]!;
  const progress = Math.round(((step - 1) / (LAST - 1)) * 100);
  const trialText = trialDays ? `${trialDays} gün ücretsiz` : "Ücretsiz deneme";

  return (
    <AuthShell
      panelTitle="Ofisini dakikalar içinde kur"
      panelDesc={
        copy?.panelText ??
        `${trialText}, kart gerekmez, taahhüt yok. Kurulum sihirbazı ofisini adım adım hazırlar; istersen örnek müşteri, portföy ve anlaşmalarla dolu başlar, tek tuşla gerçek kullanıma geçersin.`
      }
    >
      <div className="mt-8 lg:mt-0">
        <h1 className="font-display text-3xl font-extrabold text-ink-950">{copy?.title ?? "Ofisini ücretsiz kur"}</h1>
        <p className="mt-2 text-sm text-text-muted">{copy?.text ?? `${LAST} kısa adım · ${trialText} · kart gerekmez.`}</p>

        {/* İlerleme: çubuk + adım sayacı; tamamlanmış adımlara tıklanarak dönülür */}
        <div className="mt-6" aria-live="polite">
          <div className="flex items-center justify-between text-xs font-semibold text-text-muted">
            <span>
              Adım {step}/{LAST} · {current.label}
            </span>
            <span className="tabular-nums">%{progress}</span>
          </div>
          <Progress value={progress} label={`Kurulum ilerlemesi: adım ${step} / ${LAST}`} className="mt-2" />
          <ol className="mt-3 flex items-center gap-1.5" aria-label="Kurulum adımları">
            {STEPS.map((s) => {
              const done = step > s.no;
              const active = step === s.no;
              const circleCls = `grid h-8 w-8 shrink-0 place-items-center rounded-full border text-xs font-bold transition ${
                done
                  ? "border-mint-500 bg-mint-500 text-white"
                  : active
                    ? "border-brand-600 bg-brand-600 text-white shadow-[var(--shadow-glow-brand)]"
                    : "border-line bg-surface text-text-faint"
              }`;
              return (
                <li key={s.no} className="flex items-center">
                  {done ? (
                    <button type="button" onClick={() => setStep(s.no)} className={`${circleCls} cursor-pointer hover:brightness-110 focus-ring`} aria-label={`${s.no}. adıma dön: ${s.label}`} title={`${s.label} adımına dön`}>
                      <Check className="h-3.5 w-3.5" />
                    </button>
                  ) : (
                    <span className={circleCls} aria-current={active ? "step" : undefined} title={s.label}>
                      <s.icon className="h-3.5 w-3.5" />
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </div>

        <InviteBanner invite={invite} />

        <form action={action} className="mt-6" encType="multipart/form-data">
          <input type="hidden" name="plan" value={selectedPlanId} />
          <input type="hidden" name="cycle" value={initialCycle} />
          <input type="hidden" name="agents" value={selection.teamSize} />
          <input type="hidden" name={FIELD.officeType} value={officeType} />
          <input type="hidden" name={FIELD.brandColor} value={effectiveHex} />
          {focus.map((f) => (
            <input key={f} type="hidden" name={FIELD.focus} value={f} />
          ))}
          {workDistricts.map((id) => (
            <input key={id} type="hidden" name={FIELD.workDistricts} value={id} />
          ))}
          <AttributionFields attribution={attribution} />

          {/* Adım başlığı: tek soru */}
          <h2 key={`q-${step}`} className="tfs-panel font-display text-lg font-bold text-ink-950">
            {current.question}
          </h2>

          {/* ADIM 1 — Hesap */}
          <div ref={stepRefs[0]} className={step === 1 ? "tfs-panel mt-4 space-y-4" : "hidden"}>
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-ink-900" htmlFor="name">Ad soyad</label>
              <div className="relative">
                <User className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
                <input id="name" name="name" required autoComplete="name" placeholder="Adınız Soyadınız" className={inputCls} />
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-ink-900" htmlFor="email">E-posta</label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
                <EmailInput id="email" name="email" required autoComplete="email" placeholder="ornek@ofis.com" className={inputCls} />
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-ink-900" htmlFor="phone">
                Telefon <span className="font-normal text-text-faint">(opsiyonel)</span>
              </label>
              <PhoneInput id="phone" name="phone" className={plainInputCls} />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-ink-900" htmlFor="password">Şifre</label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
                <input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  required
                  minLength={8}
                  autoComplete="new-password"
                  placeholder="En az 8 karakter"
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                  className="w-full rounded-[var(--radius-card)] border border-line bg-surface py-3 pl-10 pr-11 text-sm outline-none transition focus:border-brand-400 focus:ring-4 focus:ring-brand-600/10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-[var(--radius-control)] text-text-faint transition hover:bg-canvas hover:text-ink-800"
                  aria-label={showPassword ? "Şifreyi gizle" : "Şifreyi göster"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <PasswordStrengthMeter password={pw} />
            </div>
            <button type="button" onClick={next} className={primaryBtn}>
              Devam et <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
            </button>
          </div>

          {/* ADIM 2 — Ofis */}
          <div ref={stepRefs[1]} className={step === 2 ? "tfs-panel mt-4 space-y-4" : "hidden"}>
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-ink-900" htmlFor="company">Ofis / firma adı</label>
              <div className="relative">
                <Building2 className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
                <input id="company" name="company" required placeholder="Örn. Gezertaşar Emlak" className={inputCls} />
              </div>
            </div>
            <div>
              <p className="mb-1.5 text-sm font-semibold text-ink-900">Ofisin konumu</p>
              <GeoSelect
                provinces={provinces}
                withNeighborhood={false}
                names={{ province: FIELD.provinceId, district: FIELD.districtId }}
                onSelectionChange={(sel) => {
                  if (sel.province_id !== provinceId) setWorkDistricts([]);
                  setProvinceId(sel.province_id);
                }}
              />
            </div>
            <fieldset>
              <legend className="mb-2 text-sm font-semibold text-ink-900">Ofis türü</legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {OFFICE_TYPES.map((t) => (
                  <label key={t.key} className={cardChoice(officeType === t.key)}>
                    <span className="flex items-center gap-2 font-semibold text-ink-950">
                      <input type="radio" name="office_type_choice" value={t.key} checked={officeType === t.key} onChange={() => setOfficeType(t.key)} className="accent-[var(--brand-600)]" />
                      {t.label}
                    </span>
                    <span className="pl-6 text-xs text-text-muted">{t.description}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-ink-900">
                <Users className="h-4 w-4 text-brand-600" /> Danışman sayısı
              </legend>
              <div className="flex items-center gap-2.5">
                <button type="button" aria-label="Danışman sayısını azalt" disabled={seats <= 1} onClick={() => commitSeats(seats - 1)} className="grid h-11 w-11 shrink-0 place-items-center rounded-[var(--radius-card)] border border-line bg-surface text-lg font-semibold text-ink-950 transition hover:border-brand-300 disabled:opacity-40">
                  −
                </button>
                <input
                  id="seats"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  aria-label="Danışman sayısı"
                  value={seatsText}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, "").slice(0, 3);
                    setSeatsText(digits);
                    if (digits !== "") {
                      setSeats(Math.min(MAX_SEATS_INPUT, Math.max(1, Number(digits))));
                      setSeatsTouched(true);
                    }
                  }}
                  onBlur={() => commitSeats(seatsText === "" ? 1 : Number(seatsText))}
                  className="h-11 w-24 rounded-[var(--radius-card)] border border-line bg-surface px-3 text-center text-base font-bold tabular-nums text-ink-950 outline-none transition focus:border-brand-400 focus:ring-4 focus:ring-brand-600/10"
                />
                <button type="button" aria-label="Danışman sayısını artır" disabled={seats >= MAX_SEATS_INPUT} onClick={() => commitSeats(seats + 1)} className="grid h-11 w-11 shrink-0 place-items-center rounded-[var(--radius-card)] border border-line bg-surface text-lg font-semibold text-ink-950 transition hover:border-brand-300 disabled:opacity-40">
                  +
                </button>
                <span className="text-sm text-text-muted">kullanıcı</span>
              </div>
              <p className="mt-3 min-h-10 rounded-[var(--radius-card)] bg-brand-600/[0.06] px-3.5 py-2.5 text-sm text-ink-950" aria-live="polite">
                {selection.calc.status === "over_max" ? (
                  <>{selection.calc.limitNote}</>
                ) : (
                  <>
                    Deneme sonrası önerilen paket: <strong>{selectedPlan.name}</strong>
                    {quote ? ` · aylık ödemede ${formatNumberTr(quote.totalMonthlyTry)} ₺ / ay + KDV` : ""}
                  </>
                )}
              </p>
              {efPlannedLine(efCreditsLine(selectedPlan.efCreditsMonthly, efValuationCost ?? 0), efLive) ? (
                <p className="mt-1.5 text-xs font-semibold text-mint-700">
                  {efPlannedLine(efCreditsLine(selectedPlan.efCreditsMonthly, efValuationCost ?? 0), efLive)}
                  {efLive ? "; kontör ile ek sorgu satın alınabilir." : "."}
                </p>
              ) : null}
              <p className="mt-2 text-xs text-text-faint">Deneme boyunca tüm özellikler açık; paket sonradan değiştirilebilir.</p>
            </fieldset>
            <div className="flex gap-2.5">
              <button type="button" onClick={back} className={ghostBtn}>
                <ArrowLeft className="h-4 w-4" /> Geri
              </button>
              <button type="button" onClick={next} className={primaryBtn}>
                Devam et <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
              </button>
            </div>
          </div>

          {/* ADIM 3 — Marka */}
          <div ref={stepRefs[2]} className={step === 3 ? "tfs-panel mt-4 space-y-4" : "hidden"}>
            <div className="flex items-center gap-4">
              <div className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-card)] border border-line bg-canvas">
                {logoPreview ? (
                  <Image src={logoPreview} alt="Seçilen logo önizlemesi" fill className="object-contain p-1" unoptimized />
                ) : (
                  <Building2 className="h-8 w-8 text-text-faint" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink-900">
                  Ofis logosu <span className="font-normal text-text-faint">(opsiyonel)</span>
                </p>
                <p className="text-xs text-text-muted">PNG, JPG veya WebP · en çok 2 MB. Sonradan Ayarlar'dan değiştirilebilir.</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" onClick={() => logoInputRef.current?.click()} className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-xs font-semibold text-ink-950 transition hover:border-brand-300 hover:bg-surface">
                    <Upload className="h-3.5 w-3.5" /> {logoPreview ? "Değiştir" : "Logo seç"}
                  </button>
                  {logoPreview ? (
                    <button type="button" onClick={clearLogo} className="rounded-[var(--radius-control)] border border-line px-3 py-2 text-xs font-semibold text-text-muted transition hover:bg-surface">
                      Kaldır
                    </button>
                  ) : null}
                </div>
                {logoName ? <p className="mt-1 truncate text-xs text-text-faint">{logoName}</p> : null}
                <input ref={logoInputRef} type="file" name={FIELD.logo} accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={handleLogo} aria-label="Logo seç" />
              </div>
            </div>
            <fieldset>
              <legend className="mb-2 text-sm font-semibold text-ink-900">Marka rengi</legend>
              <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Marka rengi">
                {BRAND_COLOR_PRESETS.map((c) => {
                  const active = !parseBrandColor(customHex) && brandColor === c.hex;
                  return (
                    <button
                      key={c.hex}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      aria-label={c.label}
                      title={c.label}
                      onClick={() => {
                        setBrandColor(c.hex);
                        setCustomHex("");
                      }}
                      className={`focus-ring grid h-9 w-9 place-items-center rounded-full border-2 transition ${active ? "border-ink-950 scale-110" : "border-transparent hover:scale-105"}`}
                      style={{ background: c.hex }}
                    >
                      {active ? <Check className="h-4 w-4 text-white" /> : null}
                    </button>
                  );
                })}
                <label className="ml-1 flex items-center gap-2 text-xs text-text-muted">
                  <span>Özel:</span>
                  <input
                    type="text"
                    inputMode="text"
                    value={customHex}
                    onChange={(e) => setCustomHex(e.target.value.trim())}
                    placeholder="#1d5fd6"
                    maxLength={7}
                    pattern="^#[0-9a-fA-F]{6}$"
                    aria-label="Özel marka rengi (hex)"
                    className="h-9 w-24 rounded-[var(--radius-control)] border border-line bg-surface px-2 font-mono text-xs outline-none focus:border-brand-400"
                  />
                </label>
              </div>
              {/* Canlı önizleme: brand-scope token'ları (uygulama kabuğundaki beyaz etiketle aynı değişkenler) */}
              <div
                className="brand-scope mt-3 flex items-center justify-between gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-3"
                style={{ "--brand-600": effectiveHex, "--brand-700": `color-mix(in srgb, ${effectiveHex} 80%, #000)` } as React.CSSProperties}
                aria-label="Panel önizlemesi"
              >
                <div className="flex items-center gap-2.5">
                  <span className="grid h-8 w-8 place-items-center rounded-[var(--radius-control)] text-white" style={{ background: effectiveHex }}>
                    <Sparkles className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="text-xs font-bold text-ink-950">Panel bu renkte görünür</p>
                    <p className="text-xs text-text-muted">Düğmeler, vurgular ve vitrin</p>
                  </div>
                </div>
                <span className="rounded-[var(--radius-control)] px-3 py-1.5 text-xs font-semibold text-white" style={{ background: effectiveHex }}>
                  Yeni portföy
                </span>
              </div>
            </fieldset>
            <div className="flex gap-2.5">
              <button type="button" onClick={back} className={ghostBtn}>
                <ArrowLeft className="h-4 w-4" /> Geri
              </button>
              <button type="button" onClick={next} className={primaryBtn}>
                Devam et <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
              </button>
            </div>
          </div>

          {/* ADIM 4 — Odak */}
          <div ref={stepRefs[3]} className={step === 4 ? "tfs-panel mt-4 space-y-4" : "hidden"}>
            <fieldset>
              <legend className="mb-2 text-sm font-semibold text-ink-900">Çalışma alanın (birden fazla seçebilirsin)</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {FOCUS_SEGMENTS.map((f) => {
                  const active = focus.includes(f.key);
                  return (
                    <label key={f.key} className={cardChoice(active)}>
                      <span className="flex items-center gap-2 font-semibold text-ink-950">
                        <input type="checkbox" checked={active} onChange={() => toggleFocus(f.key)} className="accent-[var(--brand-600)]" />
                        {f.label}
                      </span>
                      <span className="pl-6 text-xs text-text-muted">{f.description}</span>
                    </label>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-text-faint">Örnek veri paketi ve kayıp nedeni/kaynak tanımları bu seçime göre gelir.</p>
            </fieldset>
            <fieldset>
              <legend className="mb-2 text-sm font-semibold text-ink-900">
                Çalıştığın ilçeler <span className="font-normal text-text-faint">(opsiyonel, en çok {MAX_WORK_DISTRICTS})</span>
              </legend>
              {!provinceId ? (
                <p className="rounded-[var(--radius-card)] border border-dashed border-line px-3.5 py-3 text-xs text-text-muted">
                  İlçe seçmek için 2. adımda ofis ilini seç.{" "}
                  <button type="button" onClick={() => setStep(2)} className="font-semibold text-brand-600 hover:underline">
                    Ofis adımına dön
                  </button>
                </p>
              ) : loadingDistricts ? (
                <p className="flex items-center gap-2 text-xs text-text-muted">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> İlçeler yükleniyor…
                </p>
              ) : districts.length === 0 ? (
                <p className="text-xs text-text-muted">Bu ilde kayıtlı ilçe bulunamadı.</p>
              ) : (
                <div className="flex max-h-44 flex-wrap gap-1.5 overflow-y-auto rounded-[var(--radius-card)] border border-line p-2" role="group" aria-label="Çalışılan ilçeler">
                  {districts.map((d) => {
                    const active = workDistricts.includes(d.id);
                    return (
                      <button
                        key={d.id}
                        type="button"
                        aria-pressed={active}
                        onClick={() => toggleDistrict(d.id)}
                        className={`focus-ring rounded-full border px-2.5 py-1 text-xs font-semibold transition ${
                          active ? "border-brand-600 bg-brand-600 text-white" : "border-line bg-surface text-text-muted hover:border-brand-300"
                        }`}
                      >
                        {d.name}
                      </button>
                    );
                  })}
                </div>
              )}
              {workDistricts.length > 0 ? <p className="mt-1.5 text-xs text-text-faint">{workDistricts.length} ilçe seçildi.</p> : null}
            </fieldset>
            <div className="flex gap-2.5">
              <button type="button" onClick={back} className={ghostBtn}>
                <ArrowLeft className="h-4 w-4" /> Geri
              </button>
              <button type="button" onClick={next} className={primaryBtn}>
                Devam et <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
              </button>
            </div>
          </div>

          {/* ADIM 5 — Ekip daveti (opsiyonel) */}
          <div ref={stepRefs[4]} className={step === 5 ? "tfs-panel mt-4 space-y-4" : "hidden"}>
            <p className="text-sm text-text-muted">
              En çok {MAX_INVITES} danışmanın e-postasını yaz; ofis açılır açılmaz erişim bağlantısı gider. Sonradan Ekip sayfasından
              dilediğin kadar davet edebilirsin.
            </p>
            <div className="space-y-2.5">
              {Array.from({ length: MAX_INVITES }, (_, i) => (
                <div key={i} className="relative">
                  <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
                  <EmailInput id={`invite-${i}`} name={FIELD.inviteEmails} autoComplete="off" placeholder={`danisman${i + 1}@ofis.com`} aria-label={`${i + 1}. danışman e-postası`} className={inputCls} />
                </div>
              ))}
            </div>
            <p className="text-xs text-text-faint">Davet edilenler Ekip sayfasında görünür; ulaşmayan daveti oradan yineleyebilirsin. Paket koltuk sınırı aşılırsa davet atlanır ve not düşülür.</p>
            <div className="flex gap-2.5">
              <button type="button" onClick={back} className={ghostBtn}>
                <ArrowLeft className="h-4 w-4" /> Geri
              </button>
              <button type="button" onClick={next} className={primaryBtn}>
                Devam et <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
              </button>
            </div>
            <button type="button" onClick={() => setStep(LAST)} className="w-full text-center text-xs font-semibold text-text-muted hover:text-ink-950">
              Şimdilik atla
            </button>
          </div>

          {/* ADIM 6 — Demo veri + onay */}
          <div ref={stepRefs[5]} className={step === LAST ? "tfs-panel mt-4 space-y-4" : "hidden"}>
            <label className={`flex cursor-pointer items-start gap-3 rounded-[var(--radius-card)] border px-3.5 py-3 text-xs leading-relaxed transition ${demo ? "border-brand-300/60 bg-brand-600/[0.04]" : "border-line bg-surface"}`}>
              <input type="checkbox" name="demo_data" defaultChecked onChange={(e) => setDemo(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600" />
              <span className="text-text-muted">
                <strong className="flex items-center gap-1.5 text-sm text-ink-900">
                  <Sparkles className="h-4 w-4 text-amber-500" /> Demo veriyle başla
                </strong>
                Ofisin örnek müşteri, portföy, anlaşma ve randevularla dolu gelir; her ekranı gerçek akışla dene. Örnek kayıtlar
                &quot;Örnek veri&quot; rozetiyle ayrışır, vitrine ve portallara çıkmaz. Hazır olunca Ayarlar &gt; Gerçek kullanıma geç ile her an{" "}
                <strong className="text-ink-900">tek tuşla</strong> temizlenir; kendi girdiğin kayıtlara dokunulmaz.
              </span>
            </label>
            {!demo ? (
              <p className="rounded-[var(--radius-card)] border border-line bg-surface px-3.5 py-2.5 text-xs text-text-muted">
                Boş başlıyorsun: yalnız ofis tipine uygun tanımlar gelir. Örnek veriyi sonradan Başlangıç sihirbazından da yükleyebilirsin.
              </p>
            ) : null}

            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-[var(--radius-card)] border border-line bg-canvas px-3.5 py-3 text-xs">
              <dt className="text-text-faint">Paket (deneme sonrası)</dt>
              <dd className="font-semibold text-ink-950">
                {selectedPlan.name} · {formatNumberTr(seats)} kullanıcı
              </dd>
              <dt className="text-text-faint">Ofis türü</dt>
              <dd className="font-semibold text-ink-950">{OFFICE_TYPES.find((t) => t.key === officeType)?.label}</dd>
              <dt className="text-text-faint">Odak</dt>
              <dd className="font-semibold text-ink-950">{focus.length ? FOCUS_SEGMENTS.filter((f) => focus.includes(f.key)).map((f) => f.label).join(", ") : "Seçilmedi"}</dd>
              <dt className="text-text-faint">Deneme</dt>
              <dd className="font-semibold text-ink-950">{trialText} · kart gerekmez</dd>
            </dl>

            <label className="flex cursor-pointer items-start gap-2.5 rounded-[var(--radius-card)] border border-line bg-surface px-3.5 py-3 text-xs leading-relaxed text-text-muted transition hover:border-brand-300">
              <input type="checkbox" name="legal_consent" value="accepted" required className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600" />
              <span>
                <Link href="/kullanim-sartlari" target="_blank" className="font-semibold text-brand-600 hover:underline">Kullanım Şartları</Link>&apos;nı ve{" "}
                <Link href="/kvkk-aydinlatma" target="_blank" className="font-semibold text-brand-600 hover:underline">KVKK Aydınlatma Metni</Link>&apos;ni okudum, kabul ediyorum.
              </span>
            </label>

            {state.error ? (
              <div className="rounded-[var(--radius-control)] border border-danger-500/25 bg-danger-500/8 px-3.5 py-2.5" role="alert">
                <p className="text-sm font-medium text-danger-600">{state.error}</p>
                {errorTargetStep ? (
                  <button type="button" onClick={() => setStep(errorTargetStep)} className="mt-2 inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-danger-500/30 bg-surface px-3 py-1.5 text-xs font-semibold text-danger-600 transition hover:bg-danger-500/10">
                    <ArrowLeft className="h-3.5 w-3.5" /> {errorTargetStep}. adıma dön ({STEPS[errorTargetStep - 1]!.label})
                  </button>
                ) : null}
              </div>
            ) : null}

            <div className="flex gap-2.5">
              <button type="button" onClick={back} className={ghostBtn} disabled={pending}>
                <ArrowLeft className="h-4 w-4" /> Geri
              </button>
              <button type="submit" disabled={pending} className={primaryBtn}>
                {pending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> {demo ? "Ofisin hazırlanıyor, örnek veriler yükleniyor…" : "Ofisin oluşturuluyor…"}
                  </>
                ) : (
                  <>
                    <Rocket className="h-4 w-4" /> Ofisimi kur
                  </>
                )}
              </button>
            </div>
            <p className="text-center text-xs text-text-faint">Kredi kartı gerekmez · {trialText} · Taahhütsüz</p>
          </div>

          {/* Hata başka adımda gösterilirken de görünür kalsın (1-5. adımlarda) */}
          {state.error && step !== LAST ? (
            <div className="mt-4 rounded-[var(--radius-control)] border border-danger-500/25 bg-danger-500/8 px-3.5 py-2.5" role="alert">
              <p className="text-sm font-medium text-danger-600">{state.error}</p>
            </div>
          ) : null}
        </form>

        <p className="mt-8 border-t border-line pt-6 text-center text-sm text-text-muted">
          Zaten hesabın var mı?{" "}
          <Link href="/giris" className="font-semibold text-brand-600 hover:underline">
            Giriş yap
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}
