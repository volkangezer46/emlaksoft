"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { createDemoLead, deleteDemoLead, updateDemoLead, type LeadResult } from "@/app/actions/platform-sales-leads";
import { InlineTabbedPanel } from "@/components/ui/inline-tabbed-panel";
import { FormField, FormInput, FormTextarea } from "@/components/ui/form-controls";
import { PhoneInput } from "@/components/ui/phone-input";
import { EmailInput } from "@/components/ui/email-input";

export type LeadValues = {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  company: string | null;
  city: string | null;
  team_size: string | null;
  message: string | null;
};

const TABS = [
  { id: "kisi", label: "Kişi", fields: ["full_name", "phone", "email"] },
  { id: "ofis", label: "Ofis ve not", fields: ["company", "city", "team_size", "message"] },
];
const LABELS = { full_name: "Ad soyad", phone: "Telefon", email: "E-posta", company: "Şirket", city: "Şehir", team_size: "Ekip büyüklüğü", message: "Not" };

/** Aday ekle (lead yok) veya düzenle (lead var): satır içi sekmeli panel, popup yok. */
export function LeadPanel({ lead, open: openProp, onOpenChange }: { lead?: LeadValues; open?: boolean; onOpenChange?: (o: boolean) => void }) {
  const router = useRouter();
  const [inner, setInner] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : inner;
  const setOpen = (v: boolean) => (controlled ? onOpenChange?.(v) : setInner(v));
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const editing = Boolean(lead);
  const k = lead?.id ?? "new";

  function submit(fd: FormData) {
    setError(null);
    if (lead) fd.set("id", lead.id);
    start(async () => {
      const r: LeadResult = await (editing ? updateDemoLead(fd) : createDemoLead(fd));
      if (r.error) {
        setError(r.error);
        return;
      }
      setSuccess(true);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <InlineTabbedPanel
      open={open}
      onOpenChange={(v) => {
        if (v) {
          setError(null);
          setSuccess(false);
        }
        setOpen(v);
      }}
      title={editing ? "Adayı düzenle" : "Yeni aday ekle"}
      description={editing ? lead!.full_name : "Telefonla veya yüz yüze gelen adayı satış hunisine ekleyin."}
      icon={editing ? <Pencil /> : <Plus />}
      onSubmit={submit}
      pending={pending}
      error={error}
      success={success}
      summary={false}
      fieldLabels={LABELS}
      trigger={
        !controlled
          ? ({ onClick, ...aria }) =>
              editing ? (
                <button type="button" onClick={onClick} {...aria} className="focus-ring press inline-flex min-h-9 items-center gap-1.5 rounded-[var(--radius-control)] border border-line px-2.5 py-1.5 text-xs font-semibold text-ink-950 transition hover:border-brand-300">
                  <Pencil className="h-3.5 w-3.5 text-brand-600" /> Düzenle
                </button>
              ) : (
                <button type="button" onClick={onClick} {...aria} className="focus-ring press inline-flex min-h-9 items-center gap-1.5 rounded-[var(--radius-control)] bg-ink-950 px-3.5 py-2 text-xs font-bold text-white">
                  <Plus className="h-3.5 w-3.5" /> Aday ekle
                </button>
              )
          : undefined
      }
      tabs={TABS}
      panels={{
        kisi: (
          <>
            <FormField label="Ad soyad" htmlFor={`lead-name-${k}`} required className="sm:col-span-2">
              <FormInput id={`lead-name-${k}`} name="full_name" required maxLength={120} defaultValue={lead?.full_name ?? ""} />
            </FormField>
            <FormField label="Telefon" htmlFor={`lead-phone-${k}`} hint="Telefon veya e-postadan en az biri gerekli">
              <PhoneInput id={`lead-phone-${k}`} name="phone" defaultValue={lead?.phone ?? ""} />
            </FormField>
            <FormField label="E-posta" htmlFor={`lead-email-${k}`}>
              <EmailInput id={`lead-email-${k}`} name="email" defaultValue={lead?.email ?? ""} className="w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400" />
            </FormField>
          </>
        ),
        ofis: (
          <>
            <FormField label="Şirket" htmlFor={`lead-company-${k}`}>
              <FormInput id={`lead-company-${k}`} name="company" maxLength={160} defaultValue={lead?.company ?? ""} />
            </FormField>
            <FormField label="Şehir" htmlFor={`lead-city-${k}`}>
              <FormInput id={`lead-city-${k}`} name="city" maxLength={100} defaultValue={lead?.city ?? ""} />
            </FormField>
            <FormField label="Ekip büyüklüğü" htmlFor={`lead-team-${k}`}>
              <FormInput id={`lead-team-${k}`} name="team_size" maxLength={40} defaultValue={lead?.team_size ?? ""} placeholder="Örn. 5" />
            </FormField>
            <FormField label="Not" htmlFor={`lead-message-${k}`} className="sm:col-span-2">
              <FormTextarea id={`lead-message-${k}`} name="message" rows={3} maxLength={2000} defaultValue={lead?.message ?? ""} />
            </FormField>
          </>
        ),
      }}
    />
  );
}

/** Aday silme: satır içi onay (yalnız süper admin görür). */
export function DeleteLead({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (!confirm) {
    return (
      <button type="button" onClick={() => setConfirm(true)} className="focus-ring press inline-flex min-h-9 items-center gap-1.5 rounded-[var(--radius-control)] border border-danger-500/30 px-2.5 py-1.5 text-xs font-semibold text-danger-600 transition hover:bg-danger-500/10">
        <Trash2 className="h-3.5 w-3.5" /> Sil
      </button>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2 rounded-[var(--radius-control)] border border-danger-500/30 bg-danger-500/5 px-2.5 py-1.5 text-xs">
      <span className="font-semibold text-danger-600">{name} kalıcı silinsin mi?</span>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const fd = new FormData();
            fd.set("id", id);
            const r = await deleteDemoLead(fd);
            if (r.error) {
              setError(r.error);
              return;
            }
            router.refresh();
          })
        }
        className="focus-ring min-h-9 rounded-[var(--radius-control)] bg-danger-600 px-2.5 py-1 font-bold text-white disabled:opacity-60"
      >
        {pending ? "Siliniyor…" : "Evet, sil"}
      </button>
      <button type="button" disabled={pending} onClick={() => setConfirm(false)} className="focus-ring min-h-9 px-2 font-semibold text-text-muted">Vazgeç</button>
      {error ? <span role="alert" className="w-full font-semibold text-danger-600">{error}</span> : null}
    </span>
  );
}
