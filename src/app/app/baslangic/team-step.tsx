"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button, ButtonLink } from "@/components/ui/button";
import { EmailInput } from "@/components/ui/email-input";
import { PhoneInput } from "@/components/ui/phone-input";
import { createAdvisor } from "@/app/app/ekip/invite-actions";

const inputCls =
  "focus-ring w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2 text-sm text-text";

type RowState = { name: string; email: string; phone: string; status: "idle" | "ok" | "error"; message?: string };

const EMPTY: RowState[] = [
  { name: "", email: "", phone: "", status: "idle" },
  { name: "", email: "", phone: "", status: "idle" },
  { name: "", email: "", phone: "", status: "idle" },
];

/**
 * Adım "Ekibini davet et": satır içi en fazla 3 danışman daveti. Hesap açma, rol ve koltuk doğrulaması mevcut
 * `createAdvisor` action'ındadır (mükerrer akış yok); tam form için /app/ekip/yeni bağlantısı.
 */
export function TeamStep({ canInvite, nextHref }: { canInvite: boolean; nextHref: string }) {
  const router = useRouter();
  const [rows, setRows] = useState<RowState[]>(EMPTY);
  const [pending, startTransition] = useTransition();

  if (!canInvite) {
    return <Alert tone="info">Ekip daveti için ekip yönetimi yetkisi gerekir. Bu adımı atlayabilirsiniz.</Alert>;
  }

  function patch(i: number, p: Partial<RowState>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...p, status: "idle", message: undefined } : r)));
  }

  function send() {
    startTransition(async () => {
      const next = [...rows];
      for (let i = 0; i < next.length; i += 1) {
        const r = next[i];
        if (r.status === "ok" || (!r.name.trim() && !r.email.trim() && !r.phone.trim())) continue;
        const fd = new FormData();
        fd.set("full_name", r.name);
        fd.set("email", r.email);
        fd.set("phone", r.phone);
        fd.set("title", "Danışman");
        fd.set("role", "advisor");
        fd.set("invite_mode", "email");
        const res = await createAdvisor(fd);
        next[i] = res.ok
          ? { ...r, status: "ok", message: res.warnings?.[0] ?? "Davet e-postası gönderildi." }
          : { ...r, status: "error", message: res.error ?? "Davet gönderilemedi." };
      }
      setRows(next);
      router.refresh();
    });
  }

  const filled = rows.filter((r) => r.status !== "ok" && (r.name.trim() || r.email.trim() || r.phone.trim())).length;
  const sent = rows.filter((r) => r.status === "ok").length;

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {rows.map((r, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-3">
            <input
              aria-label={`Danışman ${i + 1} ad soyad`}
              placeholder="Ad soyad"
              value={r.name}
              disabled={r.status === "ok"}
              onChange={(e) => patch(i, { name: e.target.value })}
              className={inputCls}
            />
            <EmailInput
              aria-label={`Danışman ${i + 1} e-posta`}
              placeholder="E-posta"
              value={r.email}
              disabled={r.status === "ok"}
              onChange={(e) => patch(i, { email: e.target.value })}
              className={inputCls}
            />
            <PhoneInput
              aria-label={`Danışman ${i + 1} cep telefonu (isteğe bağlı)`}
              value={r.phone}
              onValueChange={(stored) => patch(i, { phone: stored })}
              className={inputCls}
            />
            {r.message ? (
              <p
                className={`motion-enter sm:col-span-3 flex items-center gap-1 text-xs font-semibold ${r.status === "ok" ? "text-mint-600" : "text-danger-500"}`}
                role="status"
              >
                {r.status === "ok" ? <Check className="h-3.5 w-3.5" aria-hidden /> : null}
                {r.message}
              </p>
            ) : null}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={send} loading={pending} disabled={filled === 0}>
          Davet gönder
        </Button>
        {sent > 0 ? (
          <Button type="button" variant="secondary" onClick={() => router.push(nextHref)}>
            Devam et
          </Button>
        ) : null}
        <ButtonLink href="/app/ekip/yeni" variant="ghost">
          Ayrıntılı davet formu (rol, şube, hedef)
        </ButtonLink>
      </div>
      <p className="text-xs text-text-faint">Davet edilenler e-postadaki bağlantıyla şifre belirler (telefon isteğe bağlıdır). Rol: Danışman. İstersen bu adımı atlayıp sonra davet edebilirsin.</p>
    </div>
  );
}
