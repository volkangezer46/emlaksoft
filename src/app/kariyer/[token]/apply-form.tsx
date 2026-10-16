"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2, Send } from "lucide-react";
import { submitCareerApplication } from "@/app/actions/recruiting-public";
import { PhoneInput } from "@/components/ui/phone-input";
import { EmailInput } from "@/components/ui/email-input";

const inputCls =
  "w-full rounded-[var(--radius-card)] border border-line bg-canvas px-3.5 py-3 text-sm text-ink-950 placeholder:text-text-faint outline-none transition focus:border-brand-400";
const labelCls = "mb-1.5 block text-xs font-semibold text-text-muted";

/**
 * Danışman başvuru formu + teşekkür ekranı (açık ev check-in deseni). Telefon zorunlu (`PhoneInput`, varsayılan TR),
 * e-posta isteğe bağlı (`EmailInput`). KVKK: aydınlatma özeti formda görünür, açık rıza kutusu işaretlenmeden gönderilmez.
 */
export function CareerApplyForm({ token, office, retentionDays }: { token: string; office: string; retentionDays: number }) {
  const [done, setDone] = useState<null | { duplicate: boolean }>(null);
  const [error, setError] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [kvkk, setKvkk] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(fd: FormData) {
    setError(null);
    fd.set("token", token);
    startTransition(async () => {
      const res = await submitCareerApplication(fd);
      if (res.error) {
        setError(res.error);
        return;
      }
      setDone({ duplicate: res.duplicate === true });
    });
  }

  if (done) {
    return (
      <div className="rounded-[var(--radius-card)] border border-mint-500/30 bg-mint-500/8 px-4 py-8 text-center" role="status">
        <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-mint-500/15 text-mint-600">
          <CheckCircle2 className="h-6 w-6" aria-hidden />
        </span>
        <p className="mt-3 text-sm font-bold text-ink-950">{done.duplicate ? "Başvurunuz zaten bize ulaşmıştı." : "Başvurunuz alındı!"}</p>
        <p className="mt-1 text-xs text-text-muted">{office} ekibi en kısa sürede sizinle iletişime geçecek.</p>
      </div>
    );
  }

  return (
    <form action={submit} className="space-y-3">
      {/* Honeypot — gerçek kullanıcılar görmez; botlar doldurursa kayıt sessizce yutulur */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute left-[-9999px] h-0 w-0 opacity-0" />

      <div>
        <label htmlFor="career-name" className={labelCls}>
          Ad soyad *
        </label>
        <input id="career-name" name="full_name" required minLength={2} maxLength={160} autoComplete="name" placeholder="Örn. Ayşe Yıldız" className={inputCls} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="career-phone" className={labelCls}>
            Cep telefonu *
          </label>
          <PhoneInput id="career-phone" name="phone" required autoComplete="tel-national" value={phone} onValueChange={setPhone} className={`${inputCls} numeric`} />
        </div>
        <div>
          <label htmlFor="career-email" className={labelCls}>
            E-posta
          </label>
          <EmailInput id="career-email" name="email" className={inputCls} placeholder="ornek@eposta.com" />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="career-exp" className={labelCls}>
            Emlak deneyimi (yıl)
          </label>
          <input id="career-exp" name="experience_years" type="number" inputMode="numeric" min={0} max={60} placeholder="Yeni başlıyorsanız 0" className={inputCls} />
        </div>
        <div>
          <label htmlFor="career-office" className={labelCls}>
            Şu anki iş / ofis
          </label>
          <input id="career-office" name="current_office" maxLength={160} autoComplete="organization" placeholder="İsteğe bağlı" className={inputCls} />
        </div>
      </div>

      <div>
        <label htmlFor="career-message" className={labelCls}>
          Kendinizden kısaca bahsedin
        </label>
        <textarea id="career-message" name="message" rows={4} maxLength={2000} placeholder="Hangi bölgeleri biliyorsunuz, neden danışman olmak istiyorsunuz?" className={inputCls} />
      </div>

      <details className="rounded-[var(--radius-card)] border border-line bg-canvas/60 px-3.5 py-2 text-xs leading-relaxed text-text-muted">
        <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-ink-950">KVKK aydınlatma özeti</summary>
        <p className="pb-2">
          Veri sorumlusu <strong className="text-ink-950">{office}</strong>&apos;dir. Ad, iletişim, deneyim ve mesaj bilgileriniz yalnızca danışman
          işe alım değerlendirmesi ve sizinle iletişim amacıyla, açık rızanıza dayanarak işlenir; üçüncü kişilerle paylaşılmaz. Başvurunuz
          sonuçlandıktan ya da hareketsiz kaldıktan sonra en geç {retentionDays} gün içinde silinir. KVKK 11. maddedeki haklarınız için ofise
          başvurabilirsiniz.
        </p>
      </details>

      <label className="flex cursor-pointer items-start gap-2.5 rounded-[var(--radius-card)] border border-line bg-canvas/60 px-3.5 py-3 text-xs leading-relaxed text-text-muted transition hover:border-brand-300">
        <input type="checkbox" name="kvkk" required checked={kvkk} onChange={(e) => setKvkk(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600 touch:h-5 touch:w-5" />
        <span>
          Kişisel verilerimin işe alım değerlendirmesi amacıyla işlenmesine açık rıza veriyorum.{" "}
          <Link href="/kvkk-aydinlatma" target="_blank" className="font-semibold text-brand-600 underline-offset-2 hover:underline">
            Aydınlatma metni
          </Link>
        </span>
      </label>

      {error ? (
        <p className="rounded-[var(--radius-control)] border border-danger-500/25 bg-danger-500/5 px-3 py-2 text-center text-xs font-semibold text-danger-500" role="alert">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending || !kvkk}
        className="btn-shine focus-ring press inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[var(--radius-card)] px-4 py-3.5 text-sm font-bold transition hover:brightness-95 disabled:pointer-events-none disabled:opacity-55"
        style={{ backgroundColor: "var(--pb-brand)", color: "var(--pb-on-brand)" }}
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
        Başvurumu gönder
      </button>
    </form>
  );
}
