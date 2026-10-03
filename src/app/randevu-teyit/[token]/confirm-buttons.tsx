"use client";

import { useState, useTransition } from "react";
import { CalendarClock, CheckCircle2, Loader2, MessageCircle, XCircle } from "lucide-react";
import {
  respondToAppointmentByToken,
  type ConfirmResponse,
} from "@/app/actions/appointments-confirm";
import { suggestAlternativeTimesByToken } from "@/app/actions/appointments-suggest";

/**
 * "Başka zaman öner" — müşteri 1-3 alternatif zaman yazar; öneri randevu notuna
 * kaydedilir ve danışmana bildirim gider. İsteğe bağlı WhatsApp kısayolu.
 */
function SuggestTimes({ token, whatsAppHref }: { token: string; whatsAppHref?: string | null }) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (sent) {
    return (
      <p className="mt-4 rounded-[var(--radius-card)] border border-mint-500/30 bg-mint-500/8 px-4 py-3 text-center text-xs font-semibold text-ink-950">
        Önerileriniz danışmanınıza iletildi. Uygun olduğunda sizinle iletişime geçecek.
      </p>
    );
  }

  const inputCls =
    "focus-ring w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2.5 text-sm text-ink-950";

  return (
    <div className="mt-4 border-t border-line pt-4">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="focus-ring press inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[var(--radius-card)] border border-line bg-surface px-4 text-sm font-bold text-ink-950 transition hover:bg-canvas"
        >
          <CalendarClock className="h-4 w-4 text-brand-600" /> Başka bir zaman öner
        </button>
      ) : (
        <form
          className="space-y-2.5"
          action={(fd) => {
            setError(null);
            fd.set("token", token);
            startTransition(async () => {
              const res = await suggestAlternativeTimesByToken(fd);
              if (res.error) setError(res.error);
              else setSent(true);
            });
          }}
        >
          <p className="text-xs text-text-muted">Size uygun 1-3 zaman seçin; danışmanınız size dönüş yapacak.</p>
          {[1, 2, 3].map((n) => (
            <input
              key={n}
              type="datetime-local"
              name={`t${n}`}
              required={n === 1}
              aria-label={`Önerilen zaman ${n}`}
              className={inputCls}
            />
          ))}
          <input name="note" maxLength={200} placeholder="Not (isteğe bağlı)" className={inputCls} aria-label="Not" />
          {error ? <p className="text-xs font-semibold text-danger-500">{error}</p> : null}
          <button
            type="submit"
            disabled={pending}
            className="btn-shine focus-ring press inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[var(--radius-card)] bg-brand-600 px-4 text-sm font-bold text-white transition hover:bg-brand-700 disabled:opacity-55"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Önerileri gönder
          </button>
        </form>
      )}
      {whatsAppHref ? (
        <a
          href={whatsAppHref}
          target="_blank"
          rel="noopener noreferrer"
          className="focus-ring mt-2 inline-flex w-full items-center justify-center gap-1.5 text-xs font-semibold text-text-muted underline-offset-2 hover:text-brand-600 hover:underline"
        >
          <MessageCircle className="h-3.5 w-3.5" /> veya WhatsApp ile yazın
        </a>
      ) : null}
    </div>
  );
}

/**
 * "Geliyorum ✓ / Katılamayacağım ✗" butonları + yanıt sonrası teşekkür ekranı.
 *
 * NEDEN CLIENT: server action sonucu (teşekkür / hata) sayfa yenilenmeden
 * gösterilir; sayfanın geri kalanı Server Component kalır. Daha önce yanıt
 * verilmişse (initialResponse) doğrudan teşekkür ekranı açılır — link ikinci
 * kez tıklandığında müşteri "bozuk mu?" hissi yaşamasın.
 */
export function ConfirmButtons({
  token,
  initialResponse,
  whatsAppHref,
}: {
  token: string;
  initialResponse: ConfirmResponse | null;
  whatsAppHref?: string | null;
}) {
  const [done, setDone] = useState<ConfirmResponse | null>(initialResponse);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function respond(response: ConfirmResponse) {
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("token", token);
      fd.set("response", response);
      const res = await respondToAppointmentByToken(fd);
      if (res.error) setError(res.error);
      else setDone(res.response ?? response);
    });
  }

  if (done) {
    const coming = done === "coming";
    return (
      <div
        className={`mt-5 rounded-[var(--radius-card)] border px-4 py-6 text-center ${
          coming ? "border-mint-500/30 bg-mint-500/8" : "border-line bg-canvas"
        }`}
      >
        <span
          className={`mx-auto grid h-11 w-11 place-items-center rounded-full ${
            coming ? "bg-mint-500/15 text-mint-600" : "bg-ink-950/8 text-text-muted"
          }`}
        >
          {coming ? <CheckCircle2 className="h-6 w-6" /> : <XCircle className="h-6 w-6" />}
        </span>
        <p className="mt-3 text-sm font-bold text-ink-950">
          {coming ? "Teşekkürler, katılımınız onaylandı!" : "Yanıtınız iletildi."}
        </p>
        <p className="mt-1 text-xs text-text-muted">
          {coming
            ? "Danışmanınız bilgilendirildi. Görüşmek üzere!"
            : "Randevu iptal edildi ve danışmanınız bilgilendirildi. Yeni bir tarih için ofisle iletişime geçebilirsiniz."}
        </p>
        {!coming ? <SuggestTimes token={token} whatsAppHref={whatsAppHref} /> : null}
      </div>
    );
  }

  return (
    <div className="mt-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => respond("coming")}
          className="btn-shine focus-ring press inline-flex items-center justify-center gap-2 rounded-[var(--radius-card)] bg-mint-600 px-4 py-3.5 text-sm font-bold text-white transition hover:bg-mint-500 disabled:pointer-events-none disabled:opacity-55"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          Geliyorum ✓
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => respond("cancelled")}
          className="focus-ring press inline-flex items-center justify-center gap-2 rounded-[var(--radius-card)] border border-danger-500/30 bg-danger-500/8 px-4 py-3.5 text-sm font-bold text-danger-500 transition hover:bg-danger-500/15 disabled:pointer-events-none disabled:opacity-55"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
          Katılamayacağım ✗
        </button>
      </div>
      <SuggestTimes token={token} whatsAppHref={whatsAppHref} />
      {error ? (
        <p className="mt-3 rounded-[var(--radius-control)] border border-danger-500/25 bg-danger-500/5 px-3 py-2 text-center text-xs font-semibold text-danger-500">
          {error}
        </p>
      ) : null}
    </div>
  );
}
