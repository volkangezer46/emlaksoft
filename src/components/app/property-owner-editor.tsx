"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Save, X } from "lucide-react";
import { updatePropertyOwnerInfo } from "@/app/actions/property-owner";
import { searchCustomers } from "@/app/actions/lookup";
import { Combobox } from "@/components/ui/combobox";
import { FormField, FormInput, FormSelect, FormTextarea } from "@/components/ui/form-controls";
import { useToast } from "@/components/app/toast-provider";
import {
  AUTHORIZATION_TYPES,
  COMMISSION_KINDS,
  DEED_STATUSES,
  LISTING_SOURCES,
  OWNER_RELATIONS,
  type OwnerInfoInput,
} from "@/lib/property-owner/info";

/** İlan sahibi bilgilerini satır içi (popup değil) düzenleme/tamamlama paneli. Kimlik/vergi numarası toplanmaz. */
export function PropertyOwnerEditor({
  propertyId,
  initial,
  hasCustomer,
  startOpen,
}: {
  propertyId: string;
  initial: OwnerInfoInput;
  hasCustomer: boolean;
  startOpen: boolean;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [open, setOpen] = useState(startOpen);
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="focus-ring press inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink-950 transition hover:bg-canvas"
      >
        <Pencil className="h-3.5 w-3.5" /> Bilgileri düzenle / tamamla
      </button>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          const res = await updatePropertyOwnerInfo(propertyId, fd);
          if (res.ok) {
            push(res.missing && res.missing.length > 0 ? `Kaydedildi. %${res.score ?? 0} tamam, ${res.missing.length} zorunlu alan eksik.` : "Kaydedildi. İlan yayına hazır.", res.missing?.length ? "info" : "ok");
            setOpen(false);
            router.refresh();
          } else push(res.error ?? "Kaydedilemedi.", "err");
        });
      }}
      className="grid gap-4 rounded-[var(--radius-card)] border border-line bg-canvas/50 p-4 sm:grid-cols-2"
    >
      {!hasCustomer ? (
        <FormField label="İlan sahibi müşteri" htmlFor="edit-owner-customer" className="sm:col-span-2" inject={false} hint="Ad, telefon veya e-posta ile arayın.">
          <Combobox
            id="edit-owner-customer"
            name="owner_customer_id"
            options={[]}
            onSearch={searchCustomers}
            minSearchLength={2}
            clearable
            placeholder="Müşteri seçin"
            searchPlaceholder="Ad, telefon veya e-posta…"
            emptyText="Müşteri bulunamadı"
          />
        </FormField>
      ) : null}
      <FormField label="Sahiple ilişki" htmlFor="edit-relation">
        <FormSelect id="edit-relation" name="owner_relation" defaultValue={initial.relation}>
          <option value="">Seçin</option>
          {OWNER_RELATIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </FormSelect>
      </FormField>
      <FormField label="İlan kaynağı" htmlFor="edit-source">
        <FormSelect id="edit-source" name="listing_source" defaultValue={initial.listingSource}>
          <option value="">Seçin</option>
          {LISTING_SOURCES.map((s) => <option key={s}>{s}</option>)}
        </FormSelect>
      </FormField>
      <FormField label="Tapu durumu" htmlFor="edit-deed">
        <FormSelect id="edit-deed" name="deed_status" defaultValue={initial.deedStatus}>
          <option value="">Seçin</option>
          {DEED_STATUSES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
        </FormSelect>
      </FormField>
      <FormField label="Tapu notu" htmlFor="edit-deed-note">
        <FormInput id="edit-deed-note" name="deed_note" maxLength={1000} defaultValue={initial.deedNote} />
      </FormField>
      <FormField label="Yetki türü" htmlFor="edit-auth-type">
        <FormSelect id="edit-auth-type" name="authorization_type" defaultValue={initial.authorizationType}>
          <option value="">Seçin</option>
          {AUTHORIZATION_TYPES.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
        </FormSelect>
      </FormField>
      <FormField label="Komisyon türü" htmlFor="edit-commission-kind">
        <FormSelect id="edit-commission-kind" name="commission_kind" defaultValue={initial.commissionKind}>
          {COMMISSION_KINDS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </FormSelect>
      </FormField>
      <FormField label="Yetki başlangıcı" htmlFor="edit-auth-start">
        <FormInput id="edit-auth-start" name="authorization_start" type="date" defaultValue={initial.authorizationStart} />
      </FormField>
      <FormField label="Yetki bitişi" htmlFor="edit-auth-end">
        <FormInput id="edit-auth-end" name="authorization_end" type="date" defaultValue={initial.authorizationEnd} />
      </FormField>
      <FormField label="Minimum fiyat" htmlFor="edit-min-price">
        <FormInput id="edit-min-price" name="min_price" inputMode="decimal" defaultValue={initial.minPrice ?? ""} />
      </FormField>
      <FormField label="Pazarlık payı (%)" htmlFor="edit-margin">
        <FormInput id="edit-margin" name="negotiation_margin_pct" inputMode="decimal" defaultValue={initial.negotiationMarginPct ?? ""} />
      </FormField>
      <FormField label="Müşteri notları" htmlFor="edit-notes" className="sm:col-span-2">
        <FormTextarea id="edit-notes" name="owner_customer_notes" rows={3} maxLength={4000} defaultValue={initial.customerNotes} />
      </FormField>
      <FormField label="Görüşme geçmişi" htmlFor="edit-history" className="sm:col-span-2">
        <FormTextarea id="edit-history" name="owner_contact_history" rows={3} maxLength={4000} defaultValue={initial.contactHistory} />
      </FormField>
      <div className="sm:col-span-2 space-y-2 text-sm">
        <label className="flex items-start gap-2">
          <input type="checkbox" name="kvkk_consent" value="1" defaultChecked={initial.kvkkConsent} className="mt-1 h-4 w-4" />
          <span>KVKK aydınlatma verildi ve onay alındı <span className="text-xs font-semibold text-danger-600">(yayın için zorunlu)</span></span>
        </label>
        <label className="flex items-start gap-2">
          <input type="checkbox" name="contact_permission" value="1" defaultChecked={initial.contactPermission} className="mt-1 h-4 w-4" />
          <span>Ticari elektronik ileti izni var</span>
        </label>
      </div>
      <div className="sm:col-span-2 flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="focus-ring press inline-flex items-center gap-2 rounded-[var(--radius-control)] bg-ink-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-ink-800 disabled:opacity-50"
        >
          <Save className="h-4 w-4" /> {pending ? "Kaydediliyor…" : "Kaydet"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="focus-ring press inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2 text-sm font-semibold text-text-muted transition hover:bg-canvas"
        >
          <X className="h-4 w-4" /> Vazgeç
        </button>
      </div>
    </form>
  );
}
