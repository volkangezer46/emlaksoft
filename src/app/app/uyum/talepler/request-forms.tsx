"use client";

import { useActionState, useRef, useState } from "react";
import { Plus, Save } from "lucide-react";
import {
  createKvkkRequest,
  updateKvkkRequestStatus,
  type KvkkRequestResult,
} from "@/app/actions/kvkk-requests";
import { searchCustomers } from "@/app/actions/lookup";
import { Alert } from "@/components/ui/alert";
import { Combobox } from "@/components/ui/combobox";
import { Button } from "@/components/ui/button";
import { FormField, FormInput, FormSelect, FormTextarea } from "@/components/ui/form-controls";
import {
  DEFAULT_DUE_DAYS,
  KVKK_CUSTOMER_TYPES,
  KVKK_OFFICE_TYPES,
  KVKK_REQUEST_LABELS,
  KVKK_STATUSES,
  KVKK_STATUS_LABELS,
  type KvkkRequestType,
} from "@/lib/compliance/kvkk-requests";

const initial: KvkkRequestResult = {};

function Result({ state }: { state: KvkkRequestResult }) {
  if (state.error) return <Alert tone="danger">{state.error}</Alert>;
  if (state.ok && state.message) return <Alert tone="success">{state.message}</Alert>;
  return null;
}

/** Yeni KVKK talebi (tam sayfa içi form; popup yok). Ofis düzeyi türler yalnız yetkili rolde listelenir. */
export function NewRequestForm({ canOfficeLevel }: { canOfficeLevel: boolean }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [type, setType] = useState<KvkkRequestType>("access");
  // Başarıdan sonra Combobox seçimini sıfırlamak için anahtar (form.reset() onun durumunu silmez).
  const [resetKey, setResetKey] = useState(0);
  const [state, action, pending] = useActionState(async (prev: KvkkRequestResult, fd: FormData) => {
    const res = await createKvkkRequest(prev, fd);
    if (res.ok) {
      formRef.current?.reset();
      setResetKey((k) => k + 1);
    }
    return res;
  }, initial);
  const officeType = (KVKK_OFFICE_TYPES as readonly string[]).includes(type);

  return (
    <form ref={formRef} action={action} className="grid gap-4 sm:grid-cols-2">
      <FormField label="Talep türü" htmlFor="kr-type" required>
        <FormSelect id="kr-type" name="request_type" value={type} onChange={(e) => setType(e.target.value as KvkkRequestType)}>
          <optgroup label="Veri sahibi talepleri">
            {KVKK_CUSTOMER_TYPES.map((t) => (
              <option key={t} value={t}>{KVKK_REQUEST_LABELS[t]}</option>
            ))}
          </optgroup>
          {canOfficeLevel ? (
            <optgroup label="Ofis talepleri">
              {KVKK_OFFICE_TYPES.map((t) => (
                <option key={t} value={t}>{KVKK_REQUEST_LABELS[t]}</option>
              ))}
            </optgroup>
          ) : null}
        </FormSelect>
      </FormField>
      <FormField label="Yanıt süresi (gün)" htmlFor="kr-due" hint="Varsayılan 30 gün; 1-90 arası.">
        <FormInput id="kr-due" name="due_days" type="number" min={1} max={90} defaultValue={DEFAULT_DUE_DAYS} />
      </FormField>
      {!officeType ? (
        <>
          <FormField label="Müşteri" htmlFor="kr-customer" inject={false} hint="Kayıtlı müşteriyse seçin.">
            <Combobox
              key={resetKey}
              id="kr-customer"
              name="customer_id"
              aria-label="Müşteri"
              placeholder="Seçilmedi"
              searchPlaceholder="Müşteri ara…"
              emptyText="Eşleşen müşteri yok"
              options={[]}
              onSearch={searchCustomers}
            />
          </FormField>
          <FormField label="Başvuru sahibi adı" htmlFor="kr-name" hint="Müşteri seçilmediyse zorunlu.">
            <FormInput id="kr-name" name="requester_name" maxLength={120} />
          </FormField>
        </>
      ) : null}
      <FormField label="Not" htmlFor="kr-note" className="sm:col-span-2">
        <FormTextarea id="kr-note" name="note" rows={3} maxLength={1000} />
      </FormField>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <Button type="submit" icon={Plus} loading={pending}>Talebi kaydet</Button>
        <Result state={state} />
      </div>
    </form>
  );
}

/** Satır içi durum güncelleme. */
export function StatusForm({ id, status, canEdit }: { id: string; status: string; canEdit: boolean }) {
  const [state, action, pending] = useActionState(updateKvkkRequestStatus, initial);
  const [next, setNext] = useState(status);
  if (!canEdit) return <span className="text-xs text-text-muted">{KVKK_STATUS_LABELS[status as keyof typeof KVKK_STATUS_LABELS] ?? status}</span>;
  const finishing = next === "completed" || next === "rejected";
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <div className="flex flex-wrap items-center gap-2">
        <FormSelect name="status" aria-label="Durum" value={next} onChange={(e) => setNext(e.target.value)} className="w-auto">
          {KVKK_STATUSES.map((s) => (
            <option key={s} value={s}>{KVKK_STATUS_LABELS[s]}</option>
          ))}
        </FormSelect>
        <Button type="submit" size="sm" variant="secondary" icon={Save} loading={pending} disabled={next === status}>Kaydet</Button>
      </div>
      {finishing ? <FormInput aria-label="Çözüm notu" name="resolution_note" placeholder="Çözüm notu (zorunlu)" maxLength={1000} required /> : null}
      <Result state={state} />
    </form>
  );
}
