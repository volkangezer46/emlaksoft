"use client";

import { useState, useTransition } from "react";
import { CalendarClock, HandCoins, Loader2, Wrench, X } from "lucide-react";
import { submitPortalRequest } from "@/app/actions/customer-portal-requests";

type Variant = "offer" | "appointment" | "maintenance";

const META: Record<Variant, { open: string; icon: typeof HandCoins }> = {
  offer: { open: "Teklif ver", icon: HandCoins },
  appointment: { open: "Ertele / iptal talebi", icon: CalendarClock },
  maintenance: { open: "Bakım / arıza bildir", icon: Wrench },
};

const FIELD =
  "focus-ring mt-1 block min-h-11 w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 text-sm text-ink-950 placeholder:text-text-faint";

/**
 * Müşteri portalı istek formu (kart içinde açılan şerit; popup yok). Gönderim `submitPortalRequest` (token + SQL içi
 * sahiplik doğrulaması). Başarıda form kapanır ve onay metni kalır; danışman bildirim/görev alır.
 */
export function PortalRequestForm({ token, refId, variant }: { token: string; refId: string; variant: Variant }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"reschedule" | "cancel">("reschedule");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const Icon = META[variant].icon;

  if (msg?.ok) {
    return (
      <p role="status" className="border-t border-line px-4 py-2.5 text-xs font-semibold text-mint-700">
        {msg.text}
      </p>
    );
  }
  if (!open) {
    return (
      <div className="border-t border-line px-4 py-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="focus-ring inline-flex min-h-10 items-center gap-1.5 rounded-[var(--radius-control)] text-xs font-bold text-brand-600 hover:text-brand-700"
        >
          <Icon className="h-3.5 w-3.5" aria-hidden="true" /> {META[variant].open}
        </button>
      </div>
    );
  }
  return (
    <form
      className="space-y-3 border-t border-line px-4 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        fd.set("token", token);
        fd.set("ref_id", refId);
        fd.set("kind", variant === "offer" ? "offer" : variant === "maintenance" ? "maintenance" : kind);
        start(async () => {
          const r = await submitPortalRequest(fd);
          setMsg({ ok: r.ok, text: r.message });
        });
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-bold text-ink-950">{META[variant].open}</p>
        <button type="button" onClick={() => setOpen(false)} aria-label="Kapat" className="focus-ring grid h-9 w-9 place-items-center rounded-[var(--radius-control)] text-text-muted hover:bg-surface-hover">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      {variant === "offer" ? (
        <label className="block text-xs font-medium text-ink-950">
          Teklif tutarınız (₺)
          <input name="amount" inputMode="numeric" required maxLength={20} placeholder="Örn. 4.500.000" className={FIELD} />
        </label>
      ) : null}
      {variant === "appointment" ? (
        <>
          <fieldset className="grid grid-cols-2 gap-2">
            <legend className="sr-only">Talep türü</legend>
            {(["reschedule", "cancel"] as const).map((k) => (
              <label key={k} className={`flex min-h-11 cursor-pointer items-center justify-center rounded-[var(--radius-control)] border text-xs font-semibold ${kind === k ? "border-brand-400 bg-brand-600/8 text-brand-600" : "border-line text-text-muted"}`}>
                <input type="radio" name="kind_choice" value={k} checked={kind === k} onChange={() => setKind(k)} className="sr-only" />
                {k === "reschedule" ? "Başka zaman" : "İptal"}
              </label>
            ))}
          </fieldset>
          {kind === "reschedule" ? (
            <label className="block text-xs font-medium text-ink-950">
              Size uygun zaman
              <input name="preferred" maxLength={120} placeholder="Örn. Cumartesi öğleden sonra" className={FIELD} />
            </label>
          ) : null}
        </>
      ) : null}
      {variant === "maintenance" ? (
        <>
          <label className="block text-xs font-medium text-ink-950">
            Konu
            <input name="title" required minLength={3} maxLength={120} placeholder="Örn. Kombi arızalı" className={FIELD} />
          </label>
          <label className="block text-xs font-medium text-ink-950">
            Ayrıntı (isteğe bağlı)
            <textarea name="description" rows={3} maxLength={2000} className={`${FIELD} py-2`} />
          </label>
        </>
      ) : null}
      {variant !== "maintenance" ? (
        <label className="block text-xs font-medium text-ink-950">
          Not (isteğe bağlı)
          <textarea name="note" rows={2} maxLength={500} className={`${FIELD} py-2`} />
        </label>
      ) : null}
      {msg && !msg.ok ? (
        <p role="alert" className="text-xs font-semibold text-danger-600">
          {msg.text}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="focus-ring inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[var(--radius-control)] bg-brand-600 px-4 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-60"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
        Gönder
      </button>
      <p className="text-xs text-text-faint">Talebiniz danışmanınıza iletilir; kesinleşmesi için danışmanınız size dönüş yapar.</p>
    </form>
  );
}
