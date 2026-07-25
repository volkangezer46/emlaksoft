"use client";

import Link from "next/link";
import { useActionState, useRef, useState } from "react";
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
  Rocket,
  User,
  Users,
} from "lucide-react";
import { signUp, type AuthResult } from "@/app/actions/auth";
import { AuthShell } from "@/components/auth/auth-shell";
import { PhoneInput } from "@/components/ui/phone-input";

const initial: AuthResult = {};

const STEPS = [
  { no: 1, label: "Hesap", icon: User },
  { no: 2, label: "Ofisiniz", icon: Building2 },
  { no: 3, label: "Güvenlik", icon: Lock },
];

const TEAM_OPTIONS = [
  { value: "1", title: "Bağımsız", desc: "Tek danışman" },
  { value: "2-10", title: "2–10", desc: "Butik ofis" },
  { value: "10-50", title: "10–50", desc: "Kurumsal ofis" },
  { value: "50+", title: "50+", desc: "Zincir / franchise" },
];

function passwordScore(pw: string) {
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[A-ZĞÜŞİÖÇ]/.test(pw) && /[a-zğüşıöç]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9ĞÜŞİÖÇğüşıöç]/.test(pw)) s++;
  return Math.min(s, 4); // 0-4
}

const STRENGTH = [
  { label: "Çok zayıf", cls: "bg-danger-500", w: "w-1/4" },
  { label: "Zayıf", cls: "bg-danger-500", w: "w-1/4" },
  { label: "Orta", cls: "bg-amber-400", w: "w-2/4" },
  { label: "İyi", cls: "bg-mint-500", w: "w-3/4" },
  { label: "Güçlü", cls: "bg-mint-600", w: "w-full" },
];

export function RegisterForm() {
  const [state, action, pending] = useActionState(signUp, initial);
  const [step, setStep] = useState(1);
  const [showPassword, setShowPassword] = useState(false);
  const [pw, setPw] = useState("");
  const step1Ref = useRef<HTMLDivElement>(null);
  const step2Ref = useRef<HTMLDivElement>(null);

  const score = passwordScore(pw);
  const strength = STRENGTH[score];

  function validateStep(ref: React.RefObject<HTMLDivElement | null>) {
    const inputs = ref.current?.querySelectorAll<HTMLInputElement>("input");
    if (!inputs) return true;
    for (const el of Array.from(inputs)) {
      if (!el.reportValidity()) return false;
    }
    return true;
  }

  function next() {
    if (step === 1 && !validateStep(step1Ref)) return;
    if (step === 2 && !validateStep(step2Ref)) return;
    setStep((s) => Math.min(s + 1, 3));
  }

  const inputCls =
    "w-full rounded-[12px] border border-line bg-surface py-3 pl-10 pr-3.5 text-sm outline-none transition focus:border-brand-400 focus:ring-4 focus:ring-brand-600/10";

  return (
    <AuthShell
      panelTitle="Ofisinizi 2 dakikada dijitalleştirin"
      panelDesc="14 gün ücretsiz, kredi kartsız ve taahhütsüz. Kurulum sihirbazı ofisinizi adım adım hazırlar; verileriniz Türkiye mevzuatına uygun şekilde korunur."
    >
      <div className="mt-8 lg:mt-0">
        <h1 className="font-display text-3xl font-extrabold text-ink-950">Ücretsiz başlayın</h1>
        <p className="mt-2 text-sm text-text-muted">3 kısa adımda çalışma alanınız hazır.</p>

        {/* Adım göstergesi */}
        <ol className="mt-7 flex items-center gap-2" aria-label="Kayıt adımları">
          {STEPS.map((s, i) => {
            const done = step > s.no;
            const active = step === s.no;
            return (
              <li key={s.no} className="flex flex-1 items-center gap-2">
                <span
                  className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border text-xs font-bold transition ${
                    done
                      ? "border-mint-500 bg-mint-500 text-white"
                      : active
                        ? "border-brand-600 bg-brand-600 text-white shadow-[var(--shadow-glow-brand)]"
                        : "border-line bg-surface text-text-faint"
                  }`}
                >
                  {done ? <Check className="h-4 w-4" /> : <s.icon className="h-4 w-4" />}
                </span>
                <div className="min-w-0">
                  <p className={`text-[11px] font-bold ${active || done ? "text-ink-950" : "text-text-faint"}`}>{s.label}</p>
                  <div className={`mt-1 h-1 rounded-full ${done ? "bg-mint-500" : active ? "bg-brand-600" : "bg-line"} ${i === STEPS.length - 1 ? "" : ""}`} />
                </div>
              </li>
            );
          })}
        </ol>

        <form action={action} className="mt-7">
          {/* ADIM 1 — Hesap bilgileri */}
          <div ref={step1Ref} className={step === 1 ? "space-y-4" : "hidden"}>
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
                <input id="email" name="email" type="email" required autoComplete="email" placeholder="ornek@ofis.com" className={inputCls} />
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-ink-900" htmlFor="phone">Telefon <span className="font-normal text-text-faint">(opsiyonel)</span></label>
              <PhoneInput id="phone" name="phone" className="w-full rounded-[12px] border border-line bg-surface px-3.5 py-3 text-sm outline-none transition focus:border-brand-400 focus:ring-4 focus:ring-brand-600/10" />
            </div>
            <button type="button" onClick={next} className="btn-shine group flex w-full items-center justify-center gap-2 rounded-[12px] bg-[image:var(--grad-brand)] px-4 py-3 text-sm font-semibold text-white shadow-[var(--shadow-glow-brand)] transition hover:brightness-[1.06]">
              Devam et <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
            </button>
          </div>

          {/* ADIM 2 — Ofis bilgileri */}
          <div ref={step2Ref} className={step === 2 ? "space-y-4" : "hidden"}>
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-ink-900" htmlFor="company">Ofis / firma adı</label>
              <div className="relative">
                <Building2 className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
                <input id="company" name="company" required placeholder="Örn. Gezertaşar Emlak" className={inputCls} />
              </div>
            </div>
            <fieldset>
              <legend className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-ink-900">
                <Users className="h-4 w-4 text-brand-600" /> Danışman sayısı
              </legend>
              <div className="grid grid-cols-2 gap-2.5">
                {TEAM_OPTIONS.map((o) => (
                  <label key={o.value} className="group cursor-pointer">
                    <input type="radio" name="agents" value={o.value} defaultChecked={o.value === "2-10"} className="peer sr-only" />
                    <span className="block rounded-[12px] border border-line bg-surface px-3.5 py-3 transition peer-checked:border-brand-600 peer-checked:bg-brand-600/[0.05] peer-checked:ring-2 peer-checked:ring-brand-600/25 hover:border-brand-300">
                      <span className="block text-sm font-bold text-ink-950">{o.title}</span>
                      <span className="block text-[11px] text-text-muted">{o.desc}</span>
                    </span>
                  </label>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-text-faint">Ekip büyüklüğünüze göre en uygun planla başlatırız; sonradan değiştirilebilir.</p>
            </fieldset>
            <div className="flex gap-2.5">
              <button type="button" onClick={() => setStep(1)} className="flex items-center justify-center gap-1.5 rounded-[12px] border border-line px-4 py-3 text-sm font-semibold text-text-muted transition hover:bg-surface">
                <ArrowLeft className="h-4 w-4" /> Geri
              </button>
              <button type="button" onClick={next} className="btn-shine group flex flex-1 items-center justify-center gap-2 rounded-[12px] bg-[image:var(--grad-brand)] px-4 py-3 text-sm font-semibold text-white shadow-[var(--shadow-glow-brand)] transition hover:brightness-[1.06]">
                Devam et <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
              </button>
            </div>
          </div>

          {/* ADIM 3 — Güvenlik ve onay */}
          <div className={step === 3 ? "space-y-4" : "hidden"}>
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
                  className="w-full rounded-[12px] border border-line bg-surface py-3 pl-10 pr-11 text-sm outline-none transition focus:border-brand-400 focus:ring-4 focus:ring-brand-600/10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-[8px] text-text-faint transition hover:bg-canvas hover:text-ink-800"
                  aria-label={showPassword ? "Şifreyi gizle" : "Şifreyi göster"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {pw ? (
                <div className="mt-2">
                  <div className="h-1.5 overflow-hidden rounded-full bg-line">
                    <div className={`h-full rounded-full transition-all ${strength.cls} ${strength.w}`} />
                  </div>
                  <p className="mt-1 text-[11px] font-semibold text-text-muted">Şifre gücü: {strength.label}</p>
                </div>
              ) : null}
            </div>

            <label className="flex cursor-pointer items-start gap-2.5 rounded-[12px] border border-line bg-surface px-3.5 py-3 text-[12px] leading-relaxed text-text-muted transition hover:border-brand-300">
              <input type="checkbox" required className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600" />
              <span>
                <Link href="/kullanim-sartlari" target="_blank" className="font-semibold text-brand-600 hover:underline">Kullanım Şartları</Link>&apos;nı ve{" "}
                <Link href="/kvkk-aydinlatma" target="_blank" className="font-semibold text-brand-600 hover:underline">KVKK Aydınlatma Metni</Link>&apos;ni okudum, kabul ediyorum.
              </span>
            </label>

            {state.error ? (
              <p className="rounded-[10px] border border-danger-500/25 bg-danger-500/8 px-3.5 py-2.5 text-sm font-medium text-danger-600" role="alert">
                {state.error}
              </p>
            ) : null}

            <div className="flex gap-2.5">
              <button type="button" onClick={() => setStep(2)} className="flex items-center justify-center gap-1.5 rounded-[12px] border border-line px-4 py-3 text-sm font-semibold text-text-muted transition hover:bg-surface">
                <ArrowLeft className="h-4 w-4" /> Geri
              </button>
              <button
                type="submit"
                disabled={pending}
                className="btn-shine group flex flex-1 items-center justify-center gap-2 rounded-[12px] bg-[image:var(--grad-brand)] px-4 py-3 text-sm font-semibold text-white shadow-[var(--shadow-glow-brand)] transition hover:brightness-[1.06] disabled:opacity-60"
              >
                {pending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Çalışma alanı oluşturuluyor…
                  </>
                ) : (
                  <>
                    <Rocket className="h-4 w-4" /> Çalışma alanını oluştur
                  </>
                )}
              </button>
            </div>
            <p className="text-center text-[11px] text-text-faint">Kredi kartı gerekmez · 14 gün ücretsiz · Taahhütsüz</p>
          </div>
        </form>

        <p className="mt-8 border-t border-line pt-6 text-center text-sm text-text-muted">
          Zaten hesabınız var mı?{" "}
          <Link href="/giris" className="font-semibold text-brand-600 hover:underline">
            Giriş yap
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}
