"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2, MailCheck, Send } from "lucide-react";
import { submitKvkkApplication, verifyKvkkApplication } from "@/app/actions/kvkk-public";
import { EmailInput } from "@/components/ui/email-input";
import { PhoneInput } from "@/components/ui/phone-input";
import {
  DETAILS_MAX,
  PLATFORM_KVKK_TYPES,
  PLATFORM_KVKK_TYPE_HINTS,
  PLATFORM_KVKK_TYPE_LABELS,
  VERIFY_CODE_TTL_MINUTES,
  type PlatformKvkkType,
} from "@/lib/compliance/platform-kvkk";

const inputCls =
  "w-full rounded-[var(--radius-card)] border border-line bg-canvas px-3.5 py-3 text-sm text-ink-950 placeholder:text-text-faint outline-none transition focus:border-brand-400";
const labelCls = "mb-1.5 block text-xs font-semibold text-text-muted";
const btnCls =
  "focus-ring press inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-control)] bg-brand-600 px-5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60";

type Stage = { step: "form" } | { step: "code"; requestId: string; ref: string; maskedEmail: string } | { step: "done"; ref: string };

/**
 * KVKK başvuru formu (2 adım): bilgiler → e-posta doğrulama kodu → başvuru no. Sunucu eylemleri `kvkk-public.ts`
 * (hız sınırı, honeypot, kod 30 dk / 5 deneme). Honeypot alanı formun içindedir ve FormData'ya gerçekten girer.
 */
export function KvkkApplicationForm() {
  const [stage, setStage] = useState<Stage>({ step: "form" });
  const [type, setType] = useState<PlatformKvkkType>("access");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // Kod yeniden istenirse form verisi aynen gönderilir (yeni satır açılmaz, sunucu son başvuruyu günceller).
  const [lastForm, setLastForm] = useState<FormData | null>(null);

  function apply(fd: FormData) {
    setError(null);
    setInfo(null);
    start(async () => {
      const res = await submitKvkkApplication(fd);
      if (res.error) {
        setError(res.error);
        return;
      }
      if (!res.requestId) {
        setStage({ step: "done", ref: "" });
        return;
      }
      setLastForm(fd);
      setStage({ step: "code", requestId: res.requestId, ref: res.ref ?? "", maskedEmail: res.maskedEmail ?? "" });
      if (res.resent) setInfo("Yeni doğrulama kodu gönderildi.");
    });
  }

  function verify(fd: FormData) {
    if (stage.step !== "code") return;
    setError(null);
    setInfo(null);
    fd.set("request_id", stage.requestId);
    start(async () => {
      const res = await verifyKvkkApplication(fd);
      if (res.error) {
        setError(res.error);
        if (res.restart) setStage({ step: "form" });
        return;
      }
      setStage({ step: "done", ref: res.ref ?? stage.ref });
    });
  }

  if (stage.step === "done") {
    return (
      <div className="rounded-[var(--radius-card)] border border-mint-500/30 bg-mint-500/8 px-4 py-8 text-center">
        <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-mint-500/15 text-mint-600">
          <CheckCircle2 className="h-6 w-6" aria-hidden />
        </span>
        <p className="mt-3 text-sm font-bold text-ink-950">Başvurunuz alındı.</p>
        {stage.ref ? (
          <p className="mt-1 text-sm text-ink-950">
            Başvuru no: <b className="tabular-nums">{stage.ref}</b>
          </p>
        ) : null}
        <p className="mt-1 text-xs leading-relaxed text-text-muted">
          Başvurunuz en geç 30 gün içinde sonuçlandırılır ve sonuç e-posta adresinize gönderilir. Kimlik teyidi gerekirse sizinle iletişime geçeceğiz.
        </p>
      </div>
    );
  }

  if (stage.step === "code") {
    return (
      <form action={verify} className="space-y-3">
        <div className="flex items-start gap-3 rounded-[var(--radius-card)] border border-line bg-canvas/60 px-3.5 py-3">
          <MailCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" aria-hidden />
          <p className="text-xs leading-relaxed text-text-muted">
            <b className="text-ink-950">{stage.maskedEmail}</b> adresine 6 haneli doğrulama kodu gönderdik ({VERIFY_CODE_TTL_MINUTES} dakika geçerli). Başvuru no:{" "}
            <b className="tabular-nums text-ink-950">{stage.ref}</b>
          </p>
        </div>
        <div>
          <label htmlFor="kvkk-kod" className={labelCls}>
            Doğrulama kodu *
          </label>
          <input
            id="kvkk-kod"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            placeholder="6 haneli kod"
            className={`${inputCls} max-w-[12rem] tabular-nums tracking-widest`}
          />
        </div>
        {error ? (
          <p role="alert" className="text-xs font-semibold text-danger-600">
            {error}
          </p>
        ) : null}
        {info ? <p role="status" className="text-xs font-semibold text-mint-700">{info}</p> : null}
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={pending} className={btnCls}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CheckCircle2 className="h-4 w-4" aria-hidden />}
            Doğrula ve gönder
          </button>
          <button
            type="button"
            disabled={pending || !lastForm}
            onClick={() => lastForm && apply(lastForm)}
            className="focus-ring min-h-11 text-xs font-semibold text-brand-600 hover:underline disabled:opacity-60"
          >
            Kodu yeniden gönder
          </button>
        </div>
      </form>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        // onSubmit + elle FormData: hata dönerse alanlar sıfırlanmaz (form action'ı gönderimden sonra formu temizler).
        e.preventDefault();
        apply(new FormData(e.currentTarget));
      }}
      className="space-y-4"
    >
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute left-[-9999px] h-0 w-0 opacity-0" />

      <fieldset>
        <legend className={labelCls}>Başvuru türü *</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {PLATFORM_KVKK_TYPES.map((t) => (
            <label
              key={t}
              className={`flex cursor-pointer items-start gap-2.5 rounded-[var(--radius-card)] border px-3.5 py-3 text-xs leading-relaxed transition ${
                type === t ? "border-brand-400 bg-brand-600/5" : "border-line bg-canvas/60 hover:border-brand-300"
              }`}
            >
              <input type="radio" name="request_type" value={t} checked={type === t} onChange={() => setType(t)} className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600" />
              <span>
                <span className="block text-sm font-semibold text-ink-950">{PLATFORM_KVKK_TYPE_LABELS[t]}</span>
                <span className="text-text-muted">{PLATFORM_KVKK_TYPE_HINTS[t]}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="kvkk-ad" className={labelCls}>
            Ad soyad *
          </label>
          <input id="kvkk-ad" name="full_name" required minLength={2} maxLength={120} autoComplete="name" className={inputCls} />
        </div>
        <div>
          <label htmlFor="kvkk-eposta" className={labelCls}>
            E-posta *
          </label>
          <EmailInput id="kvkk-eposta" name="email" required maxLength={254} className={inputCls} />
        </div>
        <div>
          <label htmlFor="kvkk-telefon" className={labelCls}>
            Telefon <span className="font-normal text-text-faint">(isteğe bağlı; kayıtlarınızı bulmamıza yardım eder)</span>
          </label>
          <PhoneInput id="kvkk-telefon" name="phone" autoComplete="tel" value={phone} onValueChange={setPhone} className={`${inputCls} numeric`} />
        </div>
        <div>
          <label htmlFor="kvkk-ofis" className={labelCls}>
            İlgili emlak ofisi <span className="font-normal text-text-faint">(biliyorsanız)</span>
          </label>
          <input id="kvkk-ofis" name="office_hint" maxLength={160} autoComplete="off" className={inputCls} />
        </div>
      </div>

      <div>
        <label htmlFor="kvkk-talep" className={labelCls}>
          Talebiniz *
        </label>
        <textarea
          id="kvkk-talep"
          name="details"
          required
          minLength={10}
          maxLength={DETAILS_MAX}
          rows={5}
          placeholder="Talebinizi kısaca açıklayın. Kimlik numarası gibi gereksiz kişisel veri yazmayın."
          className={`${inputCls} resize-y`}
        />
      </div>

      <label className="flex cursor-pointer items-start gap-2.5 rounded-[var(--radius-card)] border border-line bg-canvas/60 px-3.5 py-3 text-xs leading-relaxed text-text-muted transition hover:border-brand-300">
        <input type="checkbox" name="consent" required className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600" />
        <span>
          Bu başvuruyu kendi adıma yaptığımı ve verdiğim bilgilerin doğru olduğunu beyan ederim. Bilgilerim yalnız başvurumun sonuçlandırılması amacıyla işlenir (
          <Link href="/kvkk-aydinlatma" target="_blank" className="font-semibold text-brand-600 underline-offset-2 hover:underline">
            KVKK aydınlatma metni
          </Link>
          ).
        </span>
      </label>

      {error ? (
        <p role="alert" className="text-xs font-semibold text-danger-600">
          {error}
        </p>
      ) : null}

      <button type="submit" disabled={pending} className={btnCls}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
        Doğrulama kodu gönder
      </button>
    </form>
  );
}
