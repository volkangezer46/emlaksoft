"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle, PhoneCall, Plus, Unlink, Users, X } from "lucide-react";
import Link from "@/components/ui/smart-link";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { FormInput, FormSelect } from "@/components/ui/form-controls";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/app/toast-provider";
import { formatTurkishPhone, toTelHref } from "@/lib/phone";
import { buildWhatsAppLink } from "@/lib/whatsapp-link";
import { RELATION_OPTIONS, type RelationView } from "@/lib/customer-relations";
import { searchCustomers } from "@/app/actions/lookup";
import { addCustomerRelation, removeCustomerRelation, type CustomerRelationResult } from "@/app/actions/customer-relations";

const initial: CustomerRelationResult = {};
const iconBtn =
  "focus-ring press grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-control)] border border-line bg-surface text-text-muted transition hover:border-brand-300 hover:text-brand-700 touch:h-11 touch:w-11";

function initials(name: string) {
  return name.split(/\s+/).map((p) => p[0] ?? "").join("").slice(0, 2).toLocaleUpperCase("tr-TR");
}

/**
 * Müşteri 360 "İlişkili kişiler" (CRM-G8): eş, aile, iş ortağı, şirket yetkilisi, avukat, tavsiye eden. İlişki iki
 * yönlüdür (karşı kişinin kartında ters etiketle görünür). Her kişide kartına bağlantı + Ara + WhatsApp. Ekleme: mevcut
 * müşteri araması (ad, telefon, e-posta) + ilişki türü + kısa not.
 */
export function CustomerRelationsCard({
  customerId,
  customerName,
  relations,
  available,
  canEdit,
}: {
  customerId: string;
  customerName: string;
  relations: RelationView[];
  available: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [adding, setAdding] = useState(false);
  const [state, action, pending] = useActionState(async (prev: CustomerRelationResult, fd: FormData) => {
    fd.set("customer_id", customerId);
    const res = await addCustomerRelation(prev, fd);
    if (res.ok) {
      push("İlişki kaydedildi", "ok");
      setAdding(false);
      router.refresh();
    }
    return res;
  }, initial);

  if (!available && relations.length === 0 && !canEdit) return null;

  return (
    <section aria-labelledby="iliskili-kisiler" className="rounded-[var(--radius-panel)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)]">
      <div className="flex items-center justify-between gap-2">
        <h2 id="iliskili-kisiler" className="flex items-center gap-2 font-display text-sm font-bold text-ink-950">
          <Users className="h-4 w-4 text-brand-600" aria-hidden /> İlişkili kişiler
          {relations.length > 0 ? <span className="rounded-full bg-canvas px-1.5 text-xs font-bold text-text-muted">{relations.length}</span> : null}
        </h2>
        {canEdit && available && !adding ? (
          <Button size="xs" variant="ghost" icon={Plus} onClick={() => setAdding(true)}>Kişi bağla</Button>
        ) : null}
      </div>

      {!available ? (
        <p className="mt-3 text-xs text-text-faint">İlişkili kişiler veritabanı güncellemesinden sonra açılır.</p>
      ) : relations.length === 0 && !adding ? (
        <p className="mt-3 text-sm text-text-muted">
          Eşi, ortağı ya da şirket yetkilisi ayrı kayıtlıysa buradan bağlayın; iki kartta da görünür ve mükerrer sanılmaz.
        </p>
      ) : (
        <ul className="mt-3 space-y-2" aria-label="İlişkili kişiler">
          {relations.map((r) => {
            const name = r.person.full_name?.trim() || "Adsız kayıt";
            const tel = toTelHref(r.person.phone);
            const wa = buildWhatsAppLink(r.person.phone, `Merhaba ${name.split(/\s+/)[0]},`);
            return (
              <li key={r.id} className="flex items-center gap-2 rounded-[var(--radius-card)] border border-line bg-canvas/50 p-2">
                <Link
                  href={`/app/musteriler/${r.person.id}`}
                  className="focus-ring flex min-w-0 flex-1 items-center gap-2.5 rounded-[var(--radius-control)] p-1 touch:min-h-11"
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-600/10 text-xs font-extrabold text-brand-700" aria-hidden>
                    {initials(name)}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-ink-950">{name}</span>
                    <span className="block truncate text-xs text-text-muted">
                      {r.label}
                      {r.person.phone ? <span className="tabular-nums"> · {formatTurkishPhone(r.person.phone)}</span> : null}
                    </span>
                    {r.note ? <span className="block truncate text-xs text-text-faint">{r.note}</span> : null}
                  </span>
                </Link>
                {tel ? (
                  <a href={tel} className={iconBtn} aria-label={`${name} kişisini ara`}>
                    <PhoneCall className="h-4 w-4" aria-hidden />
                  </a>
                ) : null}
                {wa ? (
                  <a href={wa} target="_blank" rel="noopener noreferrer" className={iconBtn} aria-label={`${name} kişisine WhatsApp'tan yaz (yeni sekmede açılır)`}>
                    <MessageCircle className="h-4 w-4" aria-hidden />
                  </a>
                ) : null}
                {canEdit ? (
                  <ConfirmDialog
                    title="İlişki kaldırılsın mı?"
                    description={`${name} ile ${customerName} arasındaki bağ kaldırılır. Müşteri kayıtları silinmez.`}
                    confirmLabel="Kaldır"
                    tone="danger"
                    trigger={
                      <Button variant="secondary" size="icon" icon={Unlink} aria-label={`${name} ilişkisini kaldır`} />
                    }
                    onConfirm={async () => {
                      const res = await removeCustomerRelation(r.id);
                      if (res.ok) {
                        push("İlişki kaldırıldı", "ok");
                        router.refresh();
                      }
                      return res;
                    }}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {adding ? (
        <form action={action} className="mt-3 space-y-3 rounded-[var(--radius-card)] border border-line bg-canvas/60 p-3">
          <div>
            <label htmlFor={`rel-person-${customerId}`} className="mb-1 block text-xs font-semibold text-text-muted">Kişi</label>
            <Combobox
              id={`rel-person-${customerId}`}
              name="related_customer_id"
              options={[]}
              onSearch={searchCustomers}
              minSearchLength={2}
              required
              placeholder="Müşteri seçin"
              searchPlaceholder="Ad, telefon veya e-posta…"
              emptyText="Müşteri bulunamadı. Önce müşteri olarak kaydedin."
            />
          </div>
          <div>
            <label htmlFor={`rel-kind-${customerId}`} className="mb-1 block text-xs font-semibold text-text-muted">
              Bu kişi, {customerName.split(/\s+/)[0]} için…
            </label>
            <FormSelect id={`rel-kind-${customerId}`} name="relation" defaultValue="es" required>
              {RELATION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </FormSelect>
          </div>
          <div>
            <label htmlFor={`rel-note-${customerId}`} className="mb-1 block text-xs font-semibold text-text-muted">Not (isteğe bağlı)</label>
            <FormInput id={`rel-note-${customerId}`} name="note" maxLength={200} placeholder="Örn. kararı birlikte veriyorlar" />
          </div>
          {state.error ? (
            <p role="alert" className="rounded-[var(--radius-control)] bg-danger-500/8 px-3 py-2 text-xs font-medium text-danger-600">{state.error}</p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" icon={X} onClick={() => setAdding(false)}>Vazgeç</Button>
            <Button type="submit" size="sm" icon={Plus} loading={pending}>{pending ? "Kaydediliyor…" : "Bağla"}</Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
