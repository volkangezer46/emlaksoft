"use client";

import { financePath } from "@/lib/finance/routes";
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Pencil, UserPlus } from "lucide-react";
import { archiveParty, upsertParty } from "@/app/actions/finance-ledger";
import { useToast } from "@/components/app/toast-provider";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { EmailInput } from "@/components/ui/email-input";
import { FormError, FormField, FormInput, FormSelect, FormTextarea } from "@/components/ui/form-controls";
import { PhoneInput } from "@/components/ui/phone-input";
import { PARTY_KIND_LABEL, PARTY_KINDS, partyKindOf, type PartyKindKey } from "@/lib/finance/party/aging";
import type { EditableParty, PartyLinkLabels } from "./party-form";

/**
 * Cari formu (yeni / düzenle) ve arşivleme — `PartyFormButton` ile yalnız ihtiyaçta yüklenir.
 * Telefon `PhoneInput`, e-posta `EmailInput` (tek merkez); sunucu `upsertParty` telefonu `parsePhoneStrict` ile doğrular.
 * VKN yalnız 10 hane (TCKN saklanmaz).
 *
 * Bağlar: `finance_party_upsert` güncellemede `customer_id`/`user_id`/`iban_last4` alanlarını gelen değerle YAZAR; bu yüzden form
 * mevcut bağları her zaman geri gönderir (düzenleme bağı düşürmez). Bağ seçicileri yalnız `canLink` iken ve ilgili türde
 * görünür: malik → müşteri kaydı (hak ediş bölümü), danışman → ekip üyesi (P12 sahipliği, prim bölümü). Tür bağla
 * uyumsuz bir türe değiştirilirse bağ korunur (veri kaybı yok); seçici yalnız gizlenir.
 */

const LINK_LIMIT = 20;

function escapeIlike(q: string): string {
  return q.replace(/[\\%_]/g, (c) => `\\${c}`).replace(/[,()]/g, " ").slice(0, 60);
}

async function searchCustomers(q: string): Promise<ComboboxOption[]> {
  const { createClient } = await import("@/lib/supabase/client");
  const { data, error } = await createClient()
    .from("customers")
    .select("id, full_name")
    .is("deleted_at", null)
    .ilike("full_name", `%${escapeIlike(q)}%`)
    .order("full_name", { ascending: true })
    .limit(LINK_LIMIT);
  if (error) return [];
  return ((data ?? []) as { id: string; full_name: string | null }[]).map((c) => ({ value: c.id, label: c.full_name?.trim() || "İsimsiz müşteri" }));
}

async function searchMembers(q: string): Promise<ComboboxOption[]> {
  const { createClient } = await import("@/lib/supabase/client");
  const { data, error } = await createClient()
    .from("profiles")
    .select("id, full_name")
    .eq("is_active", true)
    .ilike("full_name", `%${escapeIlike(q)}%`)
    .order("full_name", { ascending: true })
    .limit(LINK_LIMIT);
  if (error) return [];
  return ((data ?? []) as { id: string; full_name: string | null }[]).map((p) => ({ value: p.id, label: p.full_name?.trim() || "İsimsiz kullanıcı" }));
}

function LinkPicker({
  id,
  value,
  label,
  onChange,
  search,
  placeholder,
  searchPlaceholder,
}: {
  id: string;
  value: string;
  label: string;
  onChange: (value: string, label: string) => void;
  search: (q: string) => Promise<ComboboxOption[]>;
  placeholder: string;
  searchPlaceholder: string;
}) {
  const [seen, setSeen] = useState<ComboboxOption[]>([]);
  const onSearch = useCallback(
    async (q: string) => {
      const res = await search(q);
      setSeen(res);
      return res;
    },
    [search],
  );
  return (
    <Combobox
      id={id}
      options={value && label ? [{ value, label }] : []}
      value={value}
      onValueChange={(next) => onChange(next, seen.find((o) => o.value === next)?.label ?? (next === value ? label : ""))}
      onSearch={onSearch}
      minSearchLength={2}
      selectedLabel={label || undefined}
      placeholder={placeholder}
      searchPlaceholder={searchPlaceholder}
      emptyText="Eşleşme yok"
      clearable
    />
  );
}

export function PartyFormDialog({
  party,
  defaultKind,
  canLink,
  linkLabels,
  onClose,
}: {
  party?: EditableParty;
  defaultKind: PartyKindKey | null;
  canLink: boolean;
  linkLabels?: PartyLinkLabels;
  onClose: () => void;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<PartyKindKey>(partyKindOf(party?.kind) ?? defaultKind ?? "musteri");
  const [customer, setCustomer] = useState({ id: party?.customer_id ?? "", label: linkLabels?.customer ?? "" });
  const [member, setMember] = useState({ id: party?.user_id ?? "", label: linkLabels?.user ?? "" });

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const taxId = String(fd.get("taxId") ?? "").replace(/\D/g, "");
    if (taxId && taxId.length !== 10) return setError("Vergi kimlik numarası 10 haneli olmalı.");
    setBusy(true);
    setError(null);
    const res = await upsertParty({
      id: party?.id ?? null,
      name: String(fd.get("partyName") ?? "").trim(),
      kind: partyKindOf(fd.get("kind")) ?? "diger",
      taxId: taxId || null,
      phone: String(fd.get("phone") ?? "") || null,
      email: String(fd.get("email") ?? "") || null,
      // RPC güncellemede iban_last4'ü de gelen değerle yazar; formda alan olmadığından mevcut değer korunur.
      ibanLast4: party?.iban_last4 ?? null,
      // Bağlar her zaman gönderilir: RPC güncellemede alanı gelen değerle yazar (gönderilmezse bağ silinir).
      customerId: customer.id || null,
      userId: member.id || null,
      note: String(fd.get("note") ?? "").trim() || null,
    });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    push(party ? "Kişi/firma güncellendi" : "Kişi/firma eklendi", "ok");
    onClose();
    if (!party && res.id) router.push(`${financePath("cari")}/${res.id}`);
    else router.refresh();
  }

  async function toggleArchive() {
    if (!party) return;
    setBusy(true);
    const res = await archiveParty(party.id, !party.archived_at);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    push(party.archived_at ? "Kişi/firma arşivden çıkarıldı" : "Kişi/firma arşivlendi", "ok");
    onClose();
    router.refresh();
  }

  return (
    <Dialog open onOpenChange={(v) => (v ? undefined : onClose())}>
      <DialogContent size="md">
        <DialogHeader
          title={party ? "Kişi/firmayı düzenle" : "Yeni kişi/firma"}
          description="Kişi ya da firma: müşteri, malik, kiracı, tedarikçi, danışman. Bakiye hareketlerden ve açık kalemlerden hesaplanır."
          icon={party ? <Pencil /> : <UserPlus />}
        />
        <form onSubmit={submit}>
          <DialogBody className="grid gap-4">
            <FormField label="Ad / unvan" htmlFor="pf-name" required>
              <FormInput id="pf-name" name="partyName" maxLength={120} defaultValue={party?.name ?? ""} required autoFocus />
            </FormField>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Tür" htmlFor="pf-kind" required>
                <FormSelect id="pf-kind" name="kind" value={kind} onChange={(e) => setKind(partyKindOf(e.target.value) ?? "diger")} required>
                  {PARTY_KINDS.map((k) => (
                    <option key={k} value={k}>{PARTY_KIND_LABEL[k]}</option>
                  ))}
                </FormSelect>
              </FormField>
              <FormField label="Vergi kimlik no (VKN)" htmlFor="pf-tax" hint="İsteğe bağlı, 10 hane.">
                <FormInput id="pf-tax" name="taxId" inputMode="numeric" maxLength={10} pattern="\d{10}" defaultValue={party?.tax_id ?? ""} />
              </FormField>
            </div>
            {canLink && kind === "malik" ? (
              <FormField label="Müşteri kaydı" htmlFor="pf-customer" inject={false} hint="Mülk sahibi olarak seçili müşteri. Malik alacağı bu bağdan hesaplanır.">
                <LinkPicker
                  id="pf-customer"
                  value={customer.id}
                  label={customer.label}
                  onChange={(id, label) => setCustomer({ id, label })}
                  search={searchCustomers}
                  placeholder="Müşteri seçin"
                  searchPlaceholder="Müşteri adı yazın…"
                />
              </FormField>
            ) : null}
            {canLink && kind === "danisman" ? (
              <FormField label="Ekip üyesi" htmlFor="pf-member" inject={false} hint="Bu kişi/firma hangi kullanıcıya ait? Prim bölümü ve görünürlük bu bağa göre çalışır.">
                <LinkPicker
                  id="pf-member"
                  value={member.id}
                  label={member.label}
                  onChange={(id, label) => setMember({ id, label })}
                  search={searchMembers}
                  placeholder="Ekip üyesi seçin"
                  searchPlaceholder="Ad yazın…"
                />
              </FormField>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Telefon" htmlFor="pf-phone">
                <PhoneInput id="pf-phone" name="phone" defaultValue={party?.phone ?? ""} />
              </FormField>
              <FormField label="E-posta" htmlFor="pf-email">
                <EmailInput id="pf-email" name="email" maxLength={160} defaultValue={party?.email ?? ""} />
              </FormField>
            </div>
            <FormField label="Not" htmlFor="pf-note">
              <FormTextarea id="pf-note" name="note" rows={2} maxLength={1000} defaultValue={party?.note ?? ""} />
            </FormField>
            <FormError error={error} nextStep={null} />
          </DialogBody>
          <DialogFooter>
            {party ? (
              <Button variant="ghost" icon={party.archived_at ? ArchiveRestore : Archive} onClick={toggleArchive} disabled={busy} className="mr-auto">
                {party.archived_at ? "Arşivden çıkar" : "Arşivle"}
              </Button>
            ) : null}
            <Button variant="ghost" onClick={onClose}>Vazgeç</Button>
            <Button type="submit" variant="primary" loading={busy}>Kaydet</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
