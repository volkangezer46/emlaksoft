"use client";

import Link from "next/link";
import { startTransition, useActionState, useEffect, useState } from "react";
import { Eye, EyeOff, Loader2, Lock, Mail, Rocket, User } from "lucide-react";
import { signOut, signUp, type AuthResult } from "@/app/actions/auth";
import { AuthDivider, GoogleAuthButton, GoogleGIcon } from "@/components/auth/google-button";
import { AuthShell } from "@/components/auth/auth-shell";
import { PasswordStrengthMeter } from "@/components/auth/password-strength";
import { PhoneInput } from "@/components/ui/phone-input";
import { EmailInput } from "@/components/ui/email-input";
import {
  SIGNUP_EMAIL_EXISTS_MESSAGE,
  signupErrorTarget,
  signupFieldInputId,
  signupPhoneClientError,
  type SignupField,
} from "@/lib/signup-errors";
import type { BillingCycle, PlanId } from "@/lib/billing/plans";
import { defaultTeamSizeForPlan } from "@/lib/billing/registration-plan";

import { AttributionFields, type SignupAttributionFields } from "./attribution-fields";
import { InviteBanner, type InviteBannerData } from "./invite-banner";

const initial: AuthResult = {};

// Mobilde 16 px yazı (iOS yakınlaştırmaz) ve en az 48 px dokunma hedefi.
const inputCls =
  "min-h-12 w-full rounded-[var(--radius-card)] border border-line bg-surface py-3 pl-10 pr-3.5 text-base outline-none transition focus:border-brand-400 focus:ring-4 focus:ring-brand-600/10 sm:text-sm";
const plainInputCls =
  "min-h-12 w-full rounded-[var(--radius-card)] border border-line bg-surface px-3.5 py-3 text-base outline-none transition focus:border-brand-400 focus:ring-4 focus:ring-brand-600/10 sm:text-sm";
const primaryBtn =
  "btn-shine group flex min-h-12 w-full items-center justify-center gap-2 rounded-[var(--radius-card)] bg-[image:var(--grad-brand)] px-4 py-3 text-base font-semibold text-white shadow-[var(--shadow-glow-brand)] transition hover:brightness-[1.06] disabled:opacity-60 sm:text-sm";

/**
 * Kayıt: TEK ekran, dört soru (ad soyad, cep telefonu, e-posta, şifre). Ofis adı sorulmaz ("<Ad Soyad> Emlak" ile kurulur),
 * plan seçilmez (varsayılan planla deneme başlar), onay kutusu yok (koşullar tek satır bilgi). Konum, ekip, paket ve
 * ayrıntılar üye olduktan sonra `/app/baslangic` Kurulum sihirbazında tamamlanır. Demo verili ofis açılır.
 */
export function RegisterForm({
  initialPlan,
  initialCycle,
  trialDays,
  attribution,
  invite = null,
  copy,
  googleEnabled = false,
  googleAccount = null,
}: {
  /** "Google ile devam et" düğmesi görünsün mü (NEXT_PUBLIC_GOOGLE_AUTH_ENABLED, sunucuda okunur). */
  googleEnabled?: boolean;
  /**
   * Google ile gelen, ofisi henüz olmayan kullanıcı (/kayit/tamamla): ad önceden dolu, e-posta salt-okunur,
   * şifre yok, cep telefonu zorunlu.
   */
  googleAccount?: { name: string; email: string } | null;
  /** Üst metinler (Site içeriği, sunucuda değişkenleri çözülmüş düz metin); yoksa bugünkü metin. */
  copy?: { title: string; text: string; panelText: string };
  /** Yalnız fiyat sayfasından AÇIK plan seçimiyle gelindiyse (?plan=); yoksa sunucu varsayılan planı kullanır. */
  initialPlan?: PlanId;
  initialCycle?: BillingCycle;
  /** Gerçekte verilen deneme günü (sunucuda getEffectiveTrialDays); yoksa sayı yazılmaz. */
  trialDays?: number;
  attribution?: SignupAttributionFields;
  /** Davet bağlantısıyla gelen ziyaretçi için "X sizi davet etti" (program açık ve kod aktifse). */
  invite?: InviteBannerData | null;
}) {
  const [state, action, pending] = useActionState(signUp, initial);
  const googleMode = googleAccount !== null;
  const [showPassword, setShowPassword] = useState(false);
  const [pw, setPw] = useState("");
  const [handledState, setHandledState] = useState(state);
  // Alan hataları ALANIN ALTINDA gösterilir; kullanıcı alanı değiştirince o alanın hatası silinir.
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<SignupField, string>>>({});
  // Alanla eşleşmeyen sunucu hatası (kayıt kapalı, hız sınırı, teknik hata).
  const [generalError, setGeneralError] = useState<string | null>(null);

  // Sunucu hatası dönünce (render sırasında durum ayarı; efekt yok).
  if (state !== handledState) {
    setHandledState(state);
    const target = signupErrorTarget(state);
    if (target.kind === "field") {
      setFieldErrors({ [target.field]: target.message });
      setGeneralError(null);
    } else {
      setFieldErrors({});
      setGeneralError(target.kind === "general" ? target.message : null);
    }
  }

  // Alan hatasında alanı odakla (yalnız DOM işlemi).
  useEffect(() => {
    const target = signupErrorTarget(state);
    if (target.kind !== "field") return;
    document.getElementById(signupFieldInputId(target.field))?.focus();
  }, [state]);

  function handleFormChange(e: React.FormEvent<HTMLFormElement>) {
    const host = (e.target as HTMLElement).closest<HTMLElement>("[data-field]");
    const field = host?.dataset.field as SignupField | undefined;
    if (field && fieldErrors[field]) {
      setFieldErrors((cur) => {
        const rest = { ...cur };
        delete rest[field];
        return rest;
      });
    }
    if (generalError) setGeneralError(null);
  }

  /**
   * React `<form action>` iş bitince formu otomatik sıfırlar; sunucu hatasından sonra alanlar boşalırdı.
   * Elle gönderip sıfırlamayı engelliyoruz (değerler düzeltme için yerinde kalır).
   */
  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const stored = form.querySelector<HTMLInputElement>('input[type="hidden"][name="phone"]')?.value;
    const phoneError = signupPhoneClientError(stored);
    if (phoneError) {
      setFieldErrors((cur) => ({ ...cur, phone: phoneError }));
      document.getElementById("phone")?.focus();
      return;
    }
    const fd = new FormData(form);
    startTransition(() => action(fd));
  }

  function fieldErrorEl(field: SignupField) {
    const msg = fieldErrors[field];
    if (!msg) return null;
    return (
      <p id={`${field}-error`} role="alert" className="mt-1 text-xs font-medium text-danger-strong">
        {msg}
        {field === "email" && msg === SIGNUP_EMAIL_EXISTS_MESSAGE ? (
          <>
            {" "}
            <Link href="/giris" className="font-semibold underline">
              Giriş yap
            </Link>
            {" · "}
            <Link href="/sifre-sifirla" className="font-semibold underline">
              Şifremi unuttum
            </Link>
          </>
        ) : null}
      </p>
    );
  }

  const trialLine = trialDays ? `${trialDays} gün ücretsiz · kart gerekmez` : "Ücretsiz deneme · kart gerekmez";
  const trialText = trialDays ? `${trialDays} gün ücretsiz` : "Ücretsiz deneme";

  return (
    <AuthShell
      panelTitle="Ofisini dakikalar içinde kur"
      panelDesc={
        copy?.panelText ??
        `${trialText}, kart gerekmez, taahhüt yok. Dört kısa soruyla üye ol; örnek müşteri, portföy ve anlaşmalarla dolu bir ofisle başla, ayrıntıları kurulum sihirbazıyla sonra tamamla.`
      }
    >
      <div className="mt-8 lg:mt-0">
        <h1 className="font-display text-3xl font-extrabold text-ink-950">
          {googleMode ? "Neredeyse hazır" : (copy?.title ?? "Ofisini ücretsiz kur")}
        </h1>
        <p className="mt-2 text-sm text-text-muted">
          {googleMode
            ? "Google hesabın doğrulandı. Cep telefonunu ekle, ofisin hemen açılsın."
            : (copy?.text ?? "Dört kısa soru yeter. Ofis bilgilerini üye olduktan sonra adım adım tamamlarsın.")}
        </p>

        <InviteBanner invite={invite} />

        <form onSubmit={handleSubmit} onChange={handleFormChange} className="mt-6 space-y-4">
          {/* Plan seçimi kayıtta yok: yalnız fiyat sayfasından açık seçimle gelindiyse taşınır, yoksa sunucu varsayılanı */}
          {initialPlan ? (
            <>
              <input type="hidden" name="plan" value={initialPlan} />
              <input type="hidden" name="cycle" value={initialCycle ?? "monthly"} />
              <input type="hidden" name="agents" value={defaultTeamSizeForPlan(initialPlan)} />
            </>
          ) : null}
          {/* Demo verili ofis: örnek kayıtlar "Örnek veri" rozetiyle ayrışır, tek tuşla silinir */}
          <input type="hidden" name="demo_data" value="on" />
          <AttributionFields attribution={attribution} />
          {googleMode ? <input type="hidden" name="auth_mode" value="google" /> : null}

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
              <input id="name" name="name" required defaultValue={googleAccount?.name ?? undefined} autoComplete="name" placeholder="Adın Soyadın" className={inputCls} aria-invalid={fieldErrors.name ? true : undefined} aria-describedby={fieldErrors.name ? "name-error" : undefined} />
            </div>
            {fieldErrorEl("name")}
          </div>

          <div data-field="phone">
            <label className="mb-1.5 block text-sm font-semibold text-ink-900" htmlFor="phone">Cep telefonu</label>
            <PhoneInput id="phone" name="phone" required autoComplete="tel" className={plainInputCls} aria-invalid={fieldErrors.phone ? true : undefined} aria-describedby={fieldErrors.phone ? "phone-error" : undefined} />
            {fieldErrorEl("phone")}
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
            <>
              <div data-field="email">
                <label className="mb-1.5 block text-sm font-semibold text-ink-900" htmlFor="email">E-posta</label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
                  <EmailInput id="email" name="email" required autoComplete="email" placeholder="ornek@ofis.com" className={inputCls} aria-invalid={fieldErrors.email ? true : undefined} aria-describedby={fieldErrors.email ? "email-error" : undefined} />
                </div>
                {fieldErrorEl("email")}
              </div>

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
                    className={`${inputCls} pr-12`}
                    aria-invalid={fieldErrors.password ? true : undefined}
                    aria-describedby={fieldErrors.password ? "password-error" : undefined}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-1 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-[var(--radius-control)] text-text-faint transition hover:bg-canvas hover:text-ink-800"
                    aria-label={showPassword ? "Şifreyi gizle" : "Şifreyi göster"}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <PasswordStrengthMeter password={pw} />
                {fieldErrorEl("password")}
              </div>
            </>
          )}

          {/* Genel bant: yalnız alanla eşleşmeyen sunucu hatası (alan hataları alanın altında). */}
          {generalError ? (
            <div className="rounded-[var(--radius-control)] border border-danger-500/25 bg-danger-500/8 px-3.5 py-2.5" role="alert">
              <p className="text-sm font-medium text-danger-600">{generalError}</p>
            </div>
          ) : null}

          <div>
            <button type="submit" disabled={pending} className={primaryBtn}>
              {pending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Ofisin hazırlanıyor…
                </>
              ) : (
                <>
                  <Rocket className="h-4 w-4" /> Ücretsiz başla
                </>
              )}
            </button>
            <p className="mt-2 text-center text-xs font-medium text-text-muted">{trialLine}</p>
            <p className="mt-3 text-center text-xs leading-relaxed text-text-faint">
              Devam ederek{" "}
              <Link href="/kullanim-sartlari" target="_blank" className="font-semibold text-brand-600 hover:underline">Kullanım koşulları</Link>
              {" "}ve{" "}
              <Link href="/kvkk-aydinlatma" target="_blank" className="font-semibold text-brand-600 hover:underline">Gizlilik (KVKK)</Link>
              {" "}metnini okuduğunu kabul etmiş olursun.
            </p>
          </div>
        </form>

        {googleMode ? (
          <form action={signOut} className="mt-8 border-t border-line pt-6 text-center text-sm text-text-muted">
            <p className="text-xs text-text-faint">
              Bir ofise davet edildiysen yeni ofis açma; davet e-postasındaki bağlantıyı kullan.
            </p>
            <button type="submit" className="mt-2 min-h-11 font-semibold text-brand-600 hover:underline">
              Farklı bir hesapla devam et
            </button>
          </form>
        ) : (
          <p className="mt-8 border-t border-line pt-6 text-center text-sm text-text-muted">
            Zaten hesabın var mı?{" "}
            <Link href="/giris" className="inline-flex min-h-11 items-center font-semibold text-brand-600 hover:underline">
              Giriş yap
            </Link>
          </p>
        )}
      </div>
    </AuthShell>
  );
}
