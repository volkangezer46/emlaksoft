"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Building2, Check, Eye, EyeOff, Loader2, Lock, Mail, Rocket, Sparkles, User } from "lucide-react";
import { signOut, signUp, type AuthResult } from "@/app/actions/auth";
import { AuthDivider, GoogleAuthButton, GoogleGIcon } from "@/components/auth/google-button";
import { AuthShell } from "@/components/auth/auth-shell";
import { PasswordStrengthMeter } from "@/components/auth/password-strength";
import { PhoneInput } from "@/components/ui/phone-input";
import { EmailInput } from "@/components/ui/email-input";
import { Progress } from "@/components/ui/progress";
import { formatNumberTr } from "@/lib/format";
import {
  SIGNUP_FIELD_STEP,
  signupErrorTarget,
  signupFieldInputId,
  signupPhoneClientError,
  type SignupField,
} from "@/lib/signup-errors";
import { efCreditsLine } from "@/lib/ef-credits/plan-credits";
import { efPlannedLine } from "@/lib/ef-credits/public-state-core";
import { PLANS, getPlan, type BillingCycle, type PlanDef, type PlanId } from "@/lib/billing/plans";
import { defaultTeamSizeForPlan } from "@/lib/billing/registration-plan";
import { registrationQuote, registrationSelection, seatBounds } from "@/lib/billing/seat-calculator-model";

import { AttributionFields, type SignupAttributionFields } from "./attribution-fields";
import { InviteBanner, type InviteBannerData } from "./invite-banner";

const initial: AuthResult = {};

/**
 * Paket seçici (motion + animasyonlu sayı) yalnız 2. adım açılınca iner: ilk boyamada ağır JS yok.
 * Yükleme sırasında aynı yükseklikte iskelet (CLS yok).
 */
const PlanPicker = dynamic(() => import("./plan-picker").then((m) => m.PlanPicker), {
  ssr: false,
  loading: () => <div className="h-[34rem] animate-pulse rounded-[var(--radius-card)] bg-line/60" aria-hidden />,
});

/** Kısa kayıt: 2 adım. Konum, adres, telefon, belge, marka, odak ve ekip uygulama içi "Ofis profilini tamamla" sihirbazındadır. */
const STEPS = [
  { no: 1, label: "Hesap", question: "Seni nasıl tanıyalım?", icon: User },
  { no: 2, label: "Ofis ve paket", question: "Ofisin ve paketin", icon: Building2 },
] as const;
const LAST = STEPS.length;

const inputCls =
  "w-full rounded-[var(--radius-card)] border border-line bg-surface py-3 pl-10 pr-3.5 text-sm outline-none transition focus:border-brand-400 focus:ring-4 focus:ring-brand-600/10";
const plainInputCls =
  "w-full rounded-[var(--radius-card)] border border-line bg-surface px-3.5 py-3 text-sm outline-none transition focus:border-brand-400 focus:ring-4 focus:ring-brand-600/10";
const primaryBtn =
  "btn-shine group flex flex-1 items-center justify-center gap-2 rounded-[var(--radius-card)] bg-[image:var(--grad-brand)] px-4 py-3 text-sm font-semibold text-white shadow-[var(--shadow-glow-brand)] transition hover:brightness-[1.06] disabled:opacity-60";
const ghostBtn =
  "flex items-center justify-center gap-1.5 rounded-[var(--radius-card)] border border-line px-4 py-3 text-sm font-semibold text-text-muted transition hover:bg-surface";

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
  googleEnabled = false,
  googleAccount = null,
}: {
  /** "Google ile devam et" düğmesi 1. adımda görünsün mü (NEXT_PUBLIC_GOOGLE_AUTH_ENABLED, sunucuda okunur). */
  googleEnabled?: boolean;
  /**
   * Google ile gelen, ofisi henüz olmayan kullanıcı (/kayit/tamamla): hesap adımı kısalır (ad önceden dolu,
   * e-posta salt-okunur, şifre yok, telefon zorunlu); ofis ve paket adımı ve rıza AYNI.
   */
  googleAccount?: { name: string; email: string } | null;
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
}) {
  // Tek hesapta satılabilecek en yüksek kullanıcı sayısı katalogdan gelir (sabit yok).
  const MAX_SEATS_INPUT = seatBounds(plans).inputMax;
  const [state, action, pending] = useActionState(signUp, initial);
  const googleMode = googleAccount !== null;
  const [step, setStep] = useState(1);
  const [showPassword, setShowPassword] = useState(false);
  const [pw, setPw] = useState("");
  const [seats, setSeats] = useState(() =>
    initialSeats && initialSeats > 0
      ? Math.min(MAX_SEATS_INPUT, Math.floor(initialSeats))
      : (plans.find((p) => p.id === initialPlan) ?? getPlan(initialPlan)).limits.seats,
  );
  // Kullanıcı sayıyı değiştirene kadar fiyat sayfasından gelen bilinçli paket seçimi korunur.
  const [seatsTouched, setSeatsTouched] = useState(initialSeats !== undefined);
  const [cycle, setCycle] = useState<BillingCycle>(initialCycle);
  // Kullanıcının elle seçtiği paket (null = motor önerisini izle). Kapasite yetmezse otomatik düşer.
  const [chosen, setChosen] = useState<PlanId | null>(null);
  const [demo, setDemo] = useState(true);
  const formRef = useRef<HTMLFormElement>(null);
  // Sunucu yanıtı işlendi mi (hata dönünce ilgili adıma geçiş, render sırasında durum ayarı; efekt yok).
  const [handledState, setHandledState] = useState(state);
  // Alan hataları ALANIN ALTINDA, ilgili adımda gösterilir; kullanıcı alanı değiştirince o alanın hatası silinir.
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<SignupField, string>>>({});
  // Alanla eşleşmeyen sunucu hatası (kayıt kapalı, hız sınırı, teknik hata): yalnız son adımın bandında.
  const [generalError, setGeneralError] = useState<string | null>(null);

  // Paket önerisi fiyat sayfasındaki hesaplayıcıyla AYNI motordan gelir (sabit eşik yok).
  const selection = registrationSelection(plans, offers, seats, cycle, seatsTouched ? null : initialPlan);
  const recommendedId = selection.calc.planId as PlanId;
  const chosenQuote = chosen ? registrationQuote(plans, offers, chosen, seats, cycle) : null;
  // Kullanıcı seçimi saygı görür; kapasite yetmiyorsa (veya hiç seçmediyse) motor önerisi geçerlidir.
  const selectedPlanId: PlanId = chosen && chosenQuote && !chosenQuote.maxSeatsExceeded ? chosen : (selection.planId as PlanId);
  const selectedPlan = plans.find((p) => p.id === selectedPlanId) ?? getPlan(selectedPlanId);
  const quote = registrationQuote(plans, offers, selectedPlanId, seats, cycle);
  // Sunucuya giden ekip kovası SEÇİLEN planın tabanıdır: sunucu seçimi yükseltir/korur, kapasiteyi düşürmez.
  const agentsBucket = defaultTeamSizeForPlan(selectedPlanId);

  // Sunucu hatası dönünce: alan hatasıysa o alanın adımına dön + alanın altına yaz; değilse genel bant.
  if (state !== handledState) {
    setHandledState(state);
    const target = signupErrorTarget(state);
    if (target.kind === "field") {
      setFieldErrors({ [target.field]: target.message });
      setGeneralError(null);
      setStep(target.step);
    } else {
      setFieldErrors({});
      setGeneralError(target.kind === "general" ? target.message : null);
    }
  }

  // Alan hatasında adım değiştikten sonra alanı odakla (yalnız DOM işlemi; durum ayarı yok).
  useEffect(() => {
    const target = signupErrorTarget(state);
    if (target.kind !== "field") return;
    document.getElementById(signupFieldInputId(target.field))?.focus();
  }, [state]);

  function clearFieldError(field: SignupField) {
    setFieldErrors((cur) => {
      if (!cur[field]) return cur;
      const rest = { ...cur };
      delete rest[field];
      return rest;
    });
  }

  /** Form içi değişiklik: değişen alanın (data-field) hatası ve genel bant temizlenir. */
  function handleFormChange(e: React.FormEvent<HTMLFormElement>) {
    const host = (e.target as HTMLElement).closest<HTMLElement>("[data-field]");
    const field = host?.dataset.field as SignupField | undefined;
    if (field) clearFieldError(field);
    if (generalError) setGeneralError(null);
  }

  /**
   * React `<form action>` iş bitince formu otomatik sıfırlar; sunucu hatasından sonra ad/e-posta/ofis
   * alanları boşalırdı. Elle gönderip sıfırlamayı engelliyoruz (değerler düzeltme için yerinde kalır).
   */
  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => action(fd));
  }

  function fieldErrorEl(field: SignupField) {
    const msg = fieldErrors[field];
    if (!msg) return null;
    return (
      <p id={`${field}-error`} role="alert" className="mt-1 text-xs font-medium text-danger-strong">
        {msg}
      </p>
    );
  }

  function changeSeats(n: number) {
    setSeats(n);
    setSeatsTouched(true);
  }

  function validateStep(no: number) {
    const panel = formRef.current?.querySelector<HTMLElement>(`[data-step="${no}"]`);
    const inputs = panel?.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input, select");
    if (!inputs) return true;
    for (const el of Array.from(inputs)) {
      if (!el.reportValidity()) return false;
    }
    return true;
  }

  function next() {
    if (!validateStep(step)) return;
    if (step === 1) {
      // Telefon opsiyonel ama girildiyse TR cep olmalı (sunucu aynı kuralı parsePhoneStrict ile uygular).
      const stored = formRef.current?.querySelector<HTMLInputElement>('input[type="hidden"][name="phone"]')?.value;
      const phoneError =
        googleMode && !(stored ?? "").trim() ? "Telefon numarası zorunlu (cep)." : signupPhoneClientError(stored);
      if (phoneError) {
        setFieldErrors((cur) => ({ ...cur, phone: phoneError }));
        document.getElementById("phone")?.focus();
        return;
      }
    }
    // Bu adımda düzeltilmemiş alan hatası varsa ilerleme; alanı odakla.
    const stuck = (Object.keys(fieldErrors) as SignupField[]).find((f) => SIGNUP_FIELD_STEP[f] === step);
    if (stuck) {
      document.getElementById(signupFieldInputId(stuck))?.focus();
      return;
    }
    setStep((s) => Math.min(s + 1, LAST));
  }
  function back() {
    setStep((s) => Math.max(1, s - 1));
  }

  const baseStep = STEPS[step - 1]!;
  const current = googleMode && step === 1 ? { ...baseStep, question: "Bilgilerini onayla" } : baseStep;
  const progress = Math.round((step / LAST) * 100);
  const trialText = trialDays ? `${trialDays} gün ücretsiz` : "Ücretsiz deneme";
  const efLine = efPlannedLine(efCreditsLine(selectedPlan.efCreditsMonthly, efValuationCost ?? 0), efLive);

  return (
    <AuthShell
      wide={step === LAST}
      panelTitle="Ofisini dakikalar içinde kur"
      panelDesc={
        copy?.panelText ??
        `${trialText}, kart gerekmez, taahhüt yok. Yalnız hesap ve ofis adı yeterli; istersen örnek müşteri, portföy ve anlaşmalarla dolu başlar, sistemi hemen dener, tek tuşla gerçek kullanıma geçersin.`
      }
    >
      <div className="mt-8 lg:mt-0">
        <h1 className="font-display text-3xl font-extrabold text-ink-950">
          {googleMode ? "Ofis kurulumunu tamamla" : (copy?.title ?? "Ofisini ücretsiz kur")}
        </h1>
        <p className="mt-2 text-sm text-text-muted">
          {googleMode
            ? `Google hesabın doğrulandı. ${LAST} kısa adımda ofisini kur · ${trialText} · kart gerekmez.`
            : (copy?.text ?? `${LAST} kısa adım · ${trialText} · kart gerekmez. Kalan bilgileri giriş yaptıktan sonra tamamlarsın.`)}
        </p>

        {/* İlerleme: çubuk + adım sayacı; tamamlanmış adıma tıklanarak dönülür */}
        <div className="mt-6" aria-live="polite">
          <div className="flex items-center justify-between text-xs font-semibold text-text-muted">
            <span>
              Adım {step}/{LAST} · {current.label}
            </span>
            <span className="tabular-nums">%{progress}</span>
          </div>
          <Progress value={progress} label={`Kayıt ilerlemesi: adım ${step} / ${LAST}`} className="mt-2" />
          <ol className="mt-3 flex items-center gap-1.5" aria-label="Kayıt adımları">
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

        <form ref={formRef} onSubmit={handleSubmit} onChange={handleFormChange} className="mt-6" encType="multipart/form-data">
          <input type="hidden" name="plan" value={selectedPlanId} />
          <input type="hidden" name="cycle" value={cycle} />
          <input type="hidden" name="agents" value={agentsBucket} />
          <AttributionFields attribution={attribution} />
          {googleMode ? <input type="hidden" name="auth_mode" value="google" /> : null}

          {/* Adım başlığı: tek soru */}
          <h2 key={`q-${step}`} className="tfs-panel font-display text-lg font-bold text-ink-950">
            {current.question}
          </h2>

          {/* ADIM 1 — Hesap */}
          <div data-step="1" className={step === 1 ? "tfs-panel mt-4 space-y-4" : "hidden"}>
            {googleMode ? (
              <div className="flex items-center gap-3 rounded-[var(--radius-card)] border border-line bg-canvas px-3.5 py-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line bg-white">
                  <GoogleGIcon />
                </span>
                <div className="min-w-0 text-xs">
                  <p className="font-semibold text-ink-950">Google hesabınla devam ediyorsun</p>
                  <p className="truncate text-text-muted">Giriş için şifre gerekmez; Google ile giriş yaparsın.</p>
                </div>
              </div>
            ) : googleEnabled ? (
              <>
                <GoogleAuthButton next="/app" />
                <AuthDivider />
              </>
            ) : null}
            <div data-field="name">
              <label className="mb-1.5 block text-sm font-semibold text-ink-900" htmlFor="name">Ad soyad</label>
              <div className="relative">
                <User className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
                <input id="name" name="name" required defaultValue={googleAccount?.name ?? undefined} autoComplete="name" placeholder="Adınız Soyadınız" className={inputCls} aria-invalid={fieldErrors.name ? true : undefined} aria-describedby={fieldErrors.name ? "name-error" : undefined} />
              </div>
              {fieldErrorEl("name")}
            </div>
            {googleMode ? (
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-ink-900" htmlFor="google-email">E-posta</label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
                  <EmailInput id="google-email" value={googleAccount?.email ?? ""} readOnly aria-readonly="true" className={`${inputCls} cursor-not-allowed bg-canvas text-text-muted`} />
                </div>
                <p className="mt-1 text-xs text-text-faint">Google hesabından gelir, değiştirilemez.</p>
              </div>
            ) : (
              <div data-field="email">
                <label className="mb-1.5 block text-sm font-semibold text-ink-900" htmlFor="email">E-posta</label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
                  <EmailInput id="email" name="email" required autoComplete="email" placeholder="ornek@ofis.com" className={inputCls} aria-invalid={fieldErrors.email ? true : undefined} aria-describedby={fieldErrors.email ? "email-error" : undefined} />
                </div>
                {fieldErrorEl("email")}
              </div>
            )}
            <div data-field="phone">
              <label className="mb-1.5 block text-sm font-semibold text-ink-900" htmlFor="phone">
                Telefon{" "}
                <span className="font-normal text-text-faint">{googleMode ? "(cep, zorunlu: güvenlik ve bildirimler için)" : "(opsiyonel, cep)"}</span>
              </label>
              <PhoneInput id="phone" name="phone" required={googleMode} className={plainInputCls} aria-invalid={fieldErrors.phone ? true : undefined} aria-describedby={fieldErrors.phone ? "phone-error" : undefined} />
              {fieldErrorEl("phone")}
            </div>
            {googleMode ? null : (
              <div data-field="password">
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
                {fieldErrorEl("password")}
              </div>
            )}
            <button type="button" onClick={next} className={primaryBtn}>
              Devam et <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
            </button>
            <p className="text-center text-xs text-text-faint">Kart gerekmez · {trialText} · Taahhüt yok</p>
          </div>

          {/* ADIM 2 — Ofis adı + paket + demo + onay */}
          <div data-step="2" className={step === 2 ? "tfs-panel mt-4 space-y-5" : "hidden"}>
            <div data-field="company">
              <label className="mb-1.5 block text-sm font-semibold text-ink-900" htmlFor="company">Ofis / firma adı</label>
              <div className="relative">
                <Building2 className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
                <input id="company" name="company" required placeholder="Örn. Gezertaşar Emlak" className={inputCls} aria-invalid={fieldErrors.company ? true : undefined} aria-describedby={fieldErrors.company ? "company-error" : undefined} />
              </div>
              {fieldErrorEl("company")}
              <p className="mt-1 text-xs text-text-faint">Konum, adres, telefon, logo ve ekip bilgilerini giriş yaptıktan sonra &quot;Ofis profilini tamamla&quot; ekranından eklersin.</p>
            </div>

            {step === 2 ? (
              <PlanPicker
                plans={plans}
                offers={offers}
                seats={seats}
                seatsMax={MAX_SEATS_INPUT}
                onSeatsChange={changeSeats}
                cycle={cycle}
                onCycleChange={setCycle}
                recommendedId={recommendedId}
                selectedId={selectedPlanId}
                onSelect={setChosen}
                overMaxNote={selection.calc.status === "over_max" ? selection.calc.limitNote : null}
                trialText={trialText}
              />
            ) : null}
            {efLine ? (
              <p className="-mt-2 text-xs font-semibold text-mint-700">
                {efLine}
                {efLive ? "; kontör ile ek sorgu satın alınabilir." : "."}
              </p>
            ) : null}

            <label className={`flex cursor-pointer items-start gap-3 rounded-[var(--radius-card)] border px-3.5 py-3 text-xs leading-relaxed transition ${demo ? "border-brand-300/60 bg-brand-600/[0.04]" : "border-line bg-surface"}`}>
              <input type="checkbox" name="demo_data" defaultChecked onChange={(e) => setDemo(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600" />
              <span className="text-text-muted">
                <strong className="flex items-center gap-1.5 text-sm text-ink-900">
                  <Sparkles className="h-4 w-4 text-amber-500" /> Demo veriyle başla
                </strong>
                Örnek müşteri, portföy, anlaşma ve randevularla dolu gelir; sistemi hemen dene. Örnek kayıtlar &quot;Örnek veri&quot; rozetiyle ayrışır,
                vitrine ve portallara çıkmaz; Ayarlar &gt; Gerçek kullanıma geç ile <strong className="text-ink-900">tek tuşla</strong> temizlenir.
              </span>
            </label>
            {!demo ? (
              <p className="-mt-3 rounded-[var(--radius-card)] border border-line bg-surface px-3.5 py-2.5 text-xs text-text-muted">
                Boş başlıyorsun. Örnek veriyi sonradan Başlangıç sihirbazından da yükleyebilirsin.
              </p>
            ) : null}

            <div data-field="legal_consent">
              <label className="flex cursor-pointer items-start gap-2.5 rounded-[var(--radius-card)] border border-line bg-surface px-3.5 py-3 text-xs leading-relaxed text-text-muted transition hover:border-brand-300">
                <input id="legal_consent" type="checkbox" name="legal_consent" value="accepted" required className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600" aria-invalid={fieldErrors.legal_consent ? true : undefined} aria-describedby={fieldErrors.legal_consent ? "legal_consent-error" : undefined} />
                <span>
                  <Link href="/kullanim-sartlari" target="_blank" className="font-semibold text-brand-600 hover:underline">Kullanım Şartları</Link>&apos;nı ve{" "}
                  <Link href="/kvkk-aydinlatma" target="_blank" className="font-semibold text-brand-600 hover:underline">KVKK Aydınlatma Metni</Link>&apos;ni okudum, kabul ediyorum.
                </span>
              </label>
              {fieldErrorEl("legal_consent")}
            </div>

            {/* Genel bant: yalnız alanla eşleşmeyen sunucu hatası (alan hataları kendi adımında, alanın altında). */}
            {generalError ? (
              <div className="rounded-[var(--radius-control)] border border-danger-500/25 bg-danger-500/8 px-3.5 py-2.5" role="alert">
                <p className="text-sm font-medium text-danger-600">{generalError}</p>
              </div>
            ) : null}

            <p className="text-center text-xs text-text-muted" aria-live="polite">
              <strong className="text-ink-950">{selectedPlan.name}</strong> · {formatNumberTr(seats)} kullanıcı
              {quote ? ` · ${formatNumberTr(cycle === "yearly" ? Math.round(quote.totalForCycleTry / 12) : quote.totalMonthlyTry)} ₺/ay + KDV (deneme sonrası)` : ""}
            </p>
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
        </form>

        {googleMode ? (
          <form action={signOut} className="mt-8 border-t border-line pt-6 text-center text-sm text-text-muted">
            <p className="text-xs text-text-faint">
              Bir ofise davet edildiysen yeni ofis açma; davet e-postasındaki bağlantıyı kullan.
            </p>
            <button type="submit" className="mt-2 font-semibold text-brand-600 hover:underline">
              Farklı bir hesapla devam et
            </button>
          </form>
        ) : (
          <p className="mt-8 border-t border-line pt-6 text-center text-sm text-text-muted">
            Zaten hesabın var mı?{" "}
            <Link href="/giris" className="font-semibold text-brand-600 hover:underline">
              Giriş yap
            </Link>
          </p>
        )}
      </div>
    </AuthShell>
  );
}
