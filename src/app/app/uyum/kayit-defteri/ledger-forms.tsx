"use client";

import { useActionState, useRef, useState } from "react";
import { Plus, Save } from "lucide-react";
import {
  addLedgerEntry,
  saveLedgerSettings,
  type LedgerActionResult,
} from "@/app/actions/compliance-ledger";
import { searchCustomers } from "@/app/actions/lookup";
import { Alert } from "@/components/ui/alert";
import { Combobox } from "@/components/ui/combobox";
import { Button } from "@/components/ui/button";
import { FormField, FormInput, FormSelect, FormTextarea } from "@/components/ui/form-controls";
import {
  LEDGER_METHODS,
  LEDGER_METHOD_LABELS,
  LEDGER_PARTY_LABELS,
  LEDGER_PARTY_ROLES,
  LEDGER_TX_LABELS,
  LEDGER_TX_TYPES,
} from "@/lib/compliance/ledger";

const initial: LedgerActionResult = {};

function Result({ state }: { state: LedgerActionResult }) {
  if (state.error) return <Alert tone="danger">{state.error}</Alert>;
  if (state.ok && state.message) return <Alert tone="success">{state.message}</Alert>;
  return null;
}

export type CorrectionDefaults = {
  id: string;
  transaction_type: string;
  transaction_date: string;
  party_name: string;
  party_role: string;
  counterparty_name: string | null;
  identity_checked: boolean;
  amount_try: number | string;
  payment_method: string;
};

/** Yeni kayıt / düzeltme kaydı formu (sayfa içi panel; popup yok). Düzeltme asıl kaydı DEĞİŞTİRMEZ. */
export function LedgerEntryForm({
  todayIso,
  correction,
}: {
  todayIso: string;
  correction: CorrectionDefaults | null;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  // Başarıdan sonra Combobox seçimini sıfırlamak için anahtar (form.reset() onun durumunu silmez).
  const [resetKey, setResetKey] = useState(0);
  const [state, action, pending] = useActionState(async (prev: LedgerActionResult, fd: FormData) => {
    const res = await addLedgerEntry(prev, fd);
    if (res.ok) {
      formRef.current?.reset();
      setResetKey((k) => k + 1);
    }
    return res;
  }, initial);
  const c = correction;

  return (
    <form
      ref={formRef}
      action={action}
      // Düzeltme seçimi değişince form varsayılanlarının yenilenmesi için anahtar.
      key={c?.id ?? "new"}
      className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
    >
      {c ? <input type="hidden" name="corrects_entry_id" value={c.id} /> : null}
      <FormField label="İşlem türü" htmlFor="lg-type" required>
        <FormSelect id="lg-type" name="transaction_type" defaultValue={c?.transaction_type ?? "sale"}>
          {LEDGER_TX_TYPES.map((t) => (
            <option key={t} value={t}>{LEDGER_TX_LABELS[t]}</option>
          ))}
        </FormSelect>
      </FormField>
      <FormField label="İşlem tarihi" htmlFor="lg-date" required>
        <FormInput id="lg-date" name="transaction_date" type="date" defaultValue={c?.transaction_date ?? todayIso} />
      </FormField>
      <FormField label="Tutar (₺)" htmlFor="lg-amount" required hint="Örn. 1.250.000 veya 1250000,50">
        <FormInput id="lg-amount" name="amount_try" inputMode="decimal" defaultValue={c ? String(c.amount_try) : ""} />
      </FormField>
      <FormField label="Taraf (ad soyad / unvan)" htmlFor="lg-party" required hint="Yalnız ad. Kimlik numarası YAZILMAZ.">
        <FormInput id="lg-party" name="party_name" maxLength={160} defaultValue={c?.party_name ?? ""} />
      </FormField>
      <FormField label="Tarafın rolü" htmlFor="lg-role" required>
        <FormSelect id="lg-role" name="party_role" defaultValue={c?.party_role ?? "buyer"}>
          {LEDGER_PARTY_ROLES.map((r) => (
            <option key={r} value={r}>{LEDGER_PARTY_LABELS[r]}</option>
          ))}
        </FormSelect>
      </FormField>
      <FormField label="Karşı taraf" htmlFor="lg-counter" hint="İsteğe bağlı.">
        <FormInput id="lg-counter" name="counterparty_name" maxLength={160} defaultValue={c?.counterparty_name ?? ""} />
      </FormField>
      <FormField label="Ödeme yöntemi" htmlFor="lg-method" required>
        <FormSelect id="lg-method" name="payment_method" defaultValue={c?.payment_method ?? "bank_transfer"}>
          {LEDGER_METHODS.map((m) => (
            <option key={m} value={m}>{LEDGER_METHOD_LABELS[m]}</option>
          ))}
        </FormSelect>
      </FormField>
      <FormField label="Müşteri bağlantısı" htmlFor="lg-customer" inject={false} hint="İsteğe bağlı; kayıt tek başına da okunur.">
        <Combobox
          key={resetKey}
          id="lg-customer"
          name="customer_id"
          aria-label="Müşteri bağlantısı"
          placeholder="Bağlanmadı"
          searchPlaceholder="Müşteri ara…"
          emptyText="Eşleşen müşteri yok"
          options={[]}
          onSearch={searchCustomers}
        />
      </FormField>
      <div className="flex items-end pb-2">
        <label className="flex min-h-11 items-center gap-2 text-sm font-semibold text-ink-950">
          <input
            type="checkbox"
            name="identity_checked"
            defaultChecked={c?.identity_checked ?? false}
            className="h-4 w-4 rounded border-line accent-brand-600"
          />
          Kimlik belgesi görüldü
        </label>
      </div>
      <FormField label="Not" htmlFor="lg-note" className="sm:col-span-2 lg:col-span-3" hint={c ? "Düzeltme gerekçesini yazın." : undefined}>
        <FormTextarea id="lg-note" name="note" rows={2} maxLength={1000} />
      </FormField>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-3">
        <Button type="submit" icon={Plus} loading={pending}>
          {c ? "Düzeltme kaydını ekle" : "Deftere ekle"}
        </Button>
        <Result state={state} />
      </div>
    </form>
  );
}

/** Ofis eşikleri ve saklama süresi (yalnız ofis sahibi / genel müdür görür). */
export function LedgerSettingsForm({
  cash,
  amount,
  years,
}: {
  cash: number;
  amount: number;
  years: number;
}) {
  const [state, action, pending] = useActionState(saveLedgerSettings, initial);
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-3">
      <FormField label="Nakit işaret eşiği (₺)" htmlFor="ls-cash" hint="0 = kapalı. Ofis ayarıdır.">
        <FormInput id="ls-cash" name="cash_threshold_try" inputMode="decimal" defaultValue={String(cash)} />
      </FormField>
      <FormField label="Tutar işaret eşiği (₺)" htmlFor="ls-amount" hint="0 = kapalı. Ofis ayarıdır.">
        <FormInput id="ls-amount" name="amount_threshold_try" inputMode="decimal" defaultValue={String(amount)} />
      </FormField>
      <FormField label="Saklama süresi (yıl)" htmlFor="ls-years" hint="Ofis ayarı; doğrulanmalı.">
        <FormInput id="ls-years" name="retention_years" type="number" min={1} max={30} defaultValue={years} />
      </FormField>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
        <Button type="submit" variant="secondary" icon={Save} loading={pending}>Ayarları kaydet</Button>
        <Result state={state} />
      </div>
    </form>
  );
}
