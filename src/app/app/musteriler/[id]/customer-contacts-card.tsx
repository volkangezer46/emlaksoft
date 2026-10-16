"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Contact, Mail, MessageCircle, MoreHorizontal, PhoneCall, Plus, Star, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FilterChip } from "@/components/ui/filter-chip";
import { PhoneInput } from "@/components/ui/phone-input";
import { EmailInput } from "@/components/ui/email-input";
import { FormSelect } from "@/components/ui/form-controls";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/app/toast-provider";
import { formatTurkishPhone, toTelHref } from "@/lib/phone";
import { buildWhatsAppLink } from "@/lib/whatsapp-link";
import {
  CONTACT_LABELS,
  EMAIL_LABEL_OPTIONS,
  MAX_EXTRA_CONTACTS,
  PHONE_LABEL_OPTIONS,
  type CustomerContact,
} from "@/lib/customer-contacts";
import {
  addCustomerContact,
  deleteCustomerContact,
  makeCustomerContactPrimary,
  type CustomerContactResult,
} from "@/app/actions/customer-contacts";

const initial: CustomerContactResult = {};
const iconBtn =
  "focus-ring press grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-control)] border border-line bg-surface text-text-muted transition hover:border-brand-300 hover:text-brand-700 touch:h-11 touch:w-11";

type Row = { key: string; kind: "phone" | "email"; value: string; label: string; primary: boolean; contactId: string | null; whatsapp: boolean };

/**
 * Müşteri 360 "İletişim bilgileri" (CRM-G7): birincil telefon/e-posta + ek numaralar (iş, ev, WhatsApp ...).
 * Her satırda doğrudan Ara / WhatsApp / e-posta; düzenleme yetkisiyle "Birincil yap" ve "Sil". Ekleme satır içi form
 * (PhoneInput / EmailInput; sunucu `parsePhoneStrict` ile doğrular). Dokunmatikte tüm hedefler ≥44 px, hover'a bağlı
 * eylem yok.
 */
export function CustomerContactsCard({
  customerId,
  firstName,
  phone,
  email,
  contacts,
  available,
  canEdit,
}: {
  customerId: string;
  firstName: string;
  phone: string | null;
  email: string | null;
  contacts: CustomerContact[];
  available: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<"phone" | "email">("phone");
  const [busy, startBusy] = useTransition();
  const [state, action, pending] = useActionState(async (prev: CustomerContactResult, fd: FormData) => {
    fd.set("customer_id", customerId);
    fd.set("kind", kind);
    const res = await addCustomerContact(prev, fd);
    if (res.ok) {
      push(kind === "phone" ? "Numara eklendi" : "E-posta eklendi", "ok");
      setAdding(false);
      router.refresh();
    }
    return res;
  }, initial);

  const rows: Row[] = [
    ...(phone ? [{ key: "p", kind: "phone" as const, value: phone, label: "Birincil", primary: true, contactId: null, whatsapp: false }] : []),
    ...contacts.filter((c) => c.kind === "phone").map((c) => ({ key: c.id, kind: "phone" as const, value: c.value, label: CONTACT_LABELS[c.label], primary: false, contactId: c.id, whatsapp: c.label === "whatsapp" })),
    ...(email ? [{ key: "e", kind: "email" as const, value: email, label: "Birincil", primary: true, contactId: null, whatsapp: false }] : []),
    ...contacts.filter((c) => c.kind === "email").map((c) => ({ key: c.id, kind: "email" as const, value: c.value, label: CONTACT_LABELS[c.label], primary: false, contactId: c.id, whatsapp: false })),
  ];
  const greeting = `Merhaba ${firstName},`;

  function run(fn: () => Promise<CustomerContactResult>, okText: string) {
    startBusy(async () => {
      const res = await fn();
      if (res.ok) {
        push(okText, "ok");
        router.refresh();
      } else push(res.error ?? "İşlem tamamlanamadı.", "err");
    });
  }

  return (
    <section aria-labelledby="iletisim-bilgileri" className="rounded-[var(--radius-panel)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)]">
      <div className="flex items-center justify-between gap-2">
        <h2 id="iletisim-bilgileri" className="flex items-center gap-2 font-display text-sm font-bold text-ink-950">
          <Contact className="h-4 w-4 text-cyan-500" aria-hidden /> İletişim bilgileri
        </h2>
        {canEdit && available && !adding && contacts.length < MAX_EXTRA_CONTACTS ? (
          <Button size="xs" variant="ghost" icon={Plus} onClick={() => setAdding(true)}>
            Ekle
          </Button>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-text-muted">Telefon veya e-posta kayıtlı değil.</p>
      ) : (
        <ul className="mt-3 divide-y divide-line" aria-label="Telefon ve e-posta listesi">
          {rows.map((r) => {
            const tel = r.kind === "phone" ? toTelHref(r.value) : null;
            const wa = r.kind === "phone" ? buildWhatsAppLink(r.value, greeting) : null;
            return (
              <li key={r.key} className="flex items-center gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <p className={`truncate text-sm font-semibold text-ink-950 ${r.kind === "phone" ? "tabular-nums" : ""}`}>
                    {r.kind === "phone" ? formatTurkishPhone(r.value) : r.value}
                  </p>
                  <p className="flex items-center gap-1 text-xs text-text-faint">
                    {r.primary ? <Star className="h-3 w-3 fill-amber-400 text-amber-400" aria-hidden /> : null}
                    {r.kind === "phone" ? "Telefon" : "E-posta"} · {r.label}
                  </p>
                </div>
                {tel ? (
                  <a href={tel} className={iconBtn} aria-label={`${formatTurkishPhone(r.value)} numarasını ara`}>
                    <PhoneCall className="h-4 w-4" aria-hidden />
                  </a>
                ) : null}
                {wa ? (
                  <a href={wa} target="_blank" rel="noopener noreferrer" className={iconBtn} aria-label={`${formatTurkishPhone(r.value)} numarasına WhatsApp'tan yaz (yeni sekmede açılır)`}>
                    <MessageCircle className={`h-4 w-4 ${r.whatsapp ? "text-mint-600" : ""}`} aria-hidden />
                  </a>
                ) : null}
                {r.kind === "email" ? (
                  <a href={`mailto:${r.value}`} className={iconBtn} aria-label={`${r.value} adresine e-posta yaz`}>
                    <Mail className="h-4 w-4" aria-hidden />
                  </a>
                ) : null}
                {canEdit && r.contactId ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger className={iconBtn} aria-label="Diğer işlemler" disabled={busy}>
                      <MoreHorizontal className="h-4 w-4" aria-hidden />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem onSelect={() => run(() => makeCustomerContactPrimary(r.contactId!), "Birincil olarak ayarlandı")}>
                        <Star /> Birincil yap
                      </DropdownMenuItem>
                      <DropdownMenuItem danger onSelect={() => run(() => deleteCustomerContact(r.contactId!), "Silindi")}>
                        <Trash2 /> Sil
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {!available ? (
        <p className="mt-2 text-xs text-text-faint">Ek numara ve e-posta özelliği veritabanı güncellemesinden sonra açılır.</p>
      ) : null}

      {adding ? (
        <form action={action} className="mt-3 space-y-3 rounded-[var(--radius-card)] border border-line bg-canvas/60 p-3">
          <div role="group" aria-label="Bilgi türü" className="flex flex-wrap gap-1.5">
            {(["phone", "email"] as const).map((k) => (
              <FilterChip key={k} active={kind === k} onClick={() => setKind(k)}>
                {k === "phone" ? "Telefon" : "E-posta"}
              </FilterChip>
            ))}
          </div>
          {kind === "phone" ? (
            <div>
              <label htmlFor={`cc-phone-${customerId}`} className="mb-1 block text-xs font-semibold text-text-muted">Numara</label>
              <PhoneInput key="phone" id={`cc-phone-${customerId}`} name="phone" required />
            </div>
          ) : (
            <div>
              <label htmlFor={`cc-email-${customerId}`} className="mb-1 block text-xs font-semibold text-text-muted">E-posta</label>
              <EmailInput key="email" id={`cc-email-${customerId}`} name="email" required className="w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-brand-400 touch:text-base" />
            </div>
          )}
          <div>
            <label htmlFor={`cc-label-${customerId}`} className="mb-1 block text-xs font-semibold text-text-muted">Etiket</label>
            <FormSelect key={kind} id={`cc-label-${customerId}`} name="label" defaultValue={kind === "phone" ? "cep" : "is"}>
              {(kind === "phone" ? PHONE_LABEL_OPTIONS : EMAIL_LABEL_OPTIONS).map((l) => (
                <option key={l} value={l}>{CONTACT_LABELS[l]}</option>
              ))}
            </FormSelect>
          </div>
          {state.error ? (
            <p role="alert" className="rounded-[var(--radius-control)] bg-danger-500/8 px-3 py-2 text-xs font-medium text-danger-600">{state.error}</p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" icon={X} onClick={() => setAdding(false)}>Vazgeç</Button>
            <Button type="submit" size="sm" icon={Plus} loading={pending}>{pending ? "Kaydediliyor…" : "Kaydet"}</Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
