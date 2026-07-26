"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import {
  respondToAppointmentByToken,
  type ConfirmResponse,
} from "@/app/actions/appointments-confirm";

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
}: {
  token: string;
  initialResponse: ConfirmResponse | null;
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
        className={`mt-5 rounded-[14px] border px-4 py-6 text-center ${
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
          className="btn-shine focus-ring press inline-flex items-center justify-center gap-2 rounded-[12px] bg-mint-600 px-4 py-3.5 text-sm font-bold text-white transition hover:bg-mint-500 disabled:pointer-events-none disabled:opacity-55"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          Geliyorum ✓
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => respond("cancelled")}
          className="focus-ring press inline-flex items-center justify-center gap-2 rounded-[12px] border border-danger-500/30 bg-danger-500/8 px-4 py-3.5 text-sm font-bold text-danger-500 transition hover:bg-danger-500/15 disabled:pointer-events-none disabled:opacity-55"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
          Katılamayacağım ✗
        </button>
      </div>
      {error ? (
        <p className="mt-3 rounded-[10px] border border-danger-500/25 bg-danger-500/5 px-3 py-2 text-center text-xs font-semibold text-danger-500">
          {error}
        </p>
      ) : null}
    </div>
  );
}
