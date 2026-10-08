"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Landmark, Link2, Link2Off, Pencil, ShieldCheck, Wallet } from "lucide-react";
import {
  recordOwnerPayout,
  revealOwnerIban,
  saveManagementAgreement,
  setOwnerCharge,
  voidOwnerPayout,
} from "@/app/actions/rental-finance";
import { useToast } from "@/components/app/toast-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormError, FormField, FormInput, FormSelect, FormTextarea } from "@/components/ui/form-controls";
import { Switch } from "@/components/ui/switch";
import { feeDescription } from "@/lib/property-management/ledger";
import { PAYMENT_METHOD_LABELS, PAYOUT_METHODS, type FeeType, type PaymentMethod } from "@/lib/property-management/payments";

function money(n: number) {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 2 }).format(n);
}
function dayLabel(iso: string) {
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(new Date(`${iso.slice(0, 10)}T00:00:00`));
}

export type AgreementVM = {
  managed: boolean;
  feeType: FeeType;
  feeValue: number;
  payoutDay: number;
  ibanMasked: string | null;
  hasIban: boolean;
  accountHolder: string | null;
  notes: string | null;
} | null;

/**
 * Yönetim sözleşmesi: ofis bu mülkü yönetiyor mu, ücret (% veya sabit TL/ay), mülk sahibine ödeme günü, IBAN.
 * IBAN KİŞİSEL VERİdir: maskeli gösterilir; açık değer yalnız "Göster" ile (her gösterim denetim kaydı bırakır) ve AI'ya gitmez.
 */
export function AgreementCard({ rentalId, agreement, canEdit }: { rentalId: string; agreement: AgreementVM; canEdit: boolean }) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(!agreement && canEdit);
  const [managed, setManaged] = useState(agreement?.managed ?? true);
  const [feeType, setFeeType] = useState<FeeType>(agreement?.feeType ?? "percent");
  const [error, setError] = useState<string | null>(null);
  const [shownIban, setShownIban] = useState<string | null>(null);

  function save(fd: FormData) {
    setError(null);
    fd.set("rental_id", rentalId);
    fd.set("managed", managed ? "1" : "0");
    start(async () => {
      const res = await saveManagementAgreement({}, fd);
      if (res.error) {
        setError(res.error);
        return;
      }
      push("Yönetim sözleşmesi kaydedildi", "ok");
      setEditing(false);
      router.refresh();
    });
  }

  function toggleIban() {
    if (shownIban) {
      setShownIban(null);
      return;
    }
    start(async () => {
      const res = await revealOwnerIban(rentalId);
      if (res.error || !res.iban) push(res.error ?? "IBAN gösterilemedi.", "err");
      else setShownIban(res.iban);
    });
  }

  return (
    <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
          <ShieldCheck className="h-4 w-4 text-brand-600" /> Yönetim sözleşmesi
          <Badge variant={agreement?.managed ? "success" : "outline"} size="sm">{agreement?.managed ? "Ofis yönetiyor" : "Yönetilmiyor"}</Badge>
        </h2>
        {canEdit && !editing ? (
          <Button size="sm" variant="outline" icon={Pencil} onClick={() => setEditing(true)}>Düzenle</Button>
        ) : null}
      </div>

      {!editing ? (
        agreement ? (
          <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-text-muted">Yönetim ücreti</dt>
              <dd className="font-semibold text-ink-950">{feeDescription(agreement.feeType, agreement.feeValue)}</dd>
            </div>
            <div>
              <dt className="text-xs text-text-muted">Mülk sahibine ödeme günü</dt>
              <dd className="font-semibold text-ink-950">Her ayın {agreement.payoutDay}. günü</dd>
            </div>
            <div>
              <dt className="text-xs text-text-muted">Hesap sahibi</dt>
              <dd className="text-ink-950">{agreement.accountHolder ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-text-muted">Mülk sahibi IBAN</dt>
              <dd className="flex flex-wrap items-center gap-2 text-ink-950">
                <span className="numeric font-mono text-xs">{shownIban ?? agreement.ibanMasked ?? "—"}</span>
                {agreement.hasIban && canEdit ? (
                  <Button size="xs" variant="ghost" icon={shownIban ? EyeOff : Eye} loading={pending} onClick={toggleIban}>
                    {shownIban ? "Gizle" : "Göster"}
                  </Button>
                ) : null}
              </dd>
            </div>
            {agreement.notes ? (
              <div className="sm:col-span-2">
                <dt className="text-xs text-text-muted">Not</dt>
                <dd className="whitespace-pre-wrap text-ink-950">{agreement.notes}</dd>
              </div>
            ) : null}
          </dl>
        ) : (
          <p className="mt-3 text-sm text-text-muted">
            Bu kira için yönetim sözleşmesi tanımlı değil. Ofis mülkü kiralayıp mülk sahibine kira ödüyorsa sözleşmeyi tanımlayın: tahsilat, yönetim ücreti ve hakediş takibi başlar.
          </p>
        )
      ) : (
        <form action={save} className="mt-4 space-y-4" aria-label="Yönetim sözleşmesi formu">
          <label className="flex items-center gap-3 text-sm font-medium text-ink-950">
            <Switch checked={managed} onCheckedChange={setManaged} aria-label="Ofis bu mülkü yönetiyor" />
            Ofis bu mülkü yönetiyor (kirayı tahsil edip mülk sahibine ödüyor)
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Ücret türü" htmlFor="fee_type" required>
              <FormSelect id="fee_type" name="fee_type" value={feeType} onChange={(e) => setFeeType(e.target.value as FeeType)}>
                <option value="percent">Kiranın yüzdesi (%)</option>
                <option value="fixed">Sabit tutar (TL / ay)</option>
              </FormSelect>
            </FormField>
            <FormField
              label={feeType === "percent" ? "Yönetim ücreti (%)" : "Yönetim ücreti (₺ / ay)"}
              htmlFor="fee_value"
              required
              hint={feeType === "percent" ? "Her tahsilattan kuruşa yuvarlanarak kesilir." : "Aynı tahakkuk için bir kez kesilir; tahsilatı aşmaz."}
            >
              <FormInput id="fee_value" name="fee_value" inputMode="decimal" required defaultValue={agreement ? String(agreement.feeValue).replace(".", ",") : ""} />
            </FormField>
            <FormField label="Mülk sahibine ödeme günü" htmlFor="payout_day" required hint="Ayın 1-28. günü; o gün ofise hatırlatma düşer.">
              <FormInput id="payout_day" name="payout_day" type="number" min={1} max={28} required defaultValue={agreement?.payoutDay ?? 5} />
            </FormField>
            <FormField label="Hesap sahibi" htmlFor="owner_account_holder">
              <FormInput id="owner_account_holder" name="owner_account_holder" maxLength={120} defaultValue={agreement?.accountHolder ?? ""} />
            </FormField>
            <FormField
              label="Mülk sahibi IBAN"
              htmlFor="owner_iban"
              hint={agreement?.hasIban ? `Kayıtlı: ${agreement.ibanMasked}. Değiştirmek için yeni IBAN yazın, boş bırakırsanız korunur.` : "TR ile başlayan 26 karakter. Kişisel veridir; maskeli gösterilir."}
              className="sm:col-span-2"
            >
              <FormInput id="owner_iban" name="owner_iban" autoComplete="off" spellCheck={false} placeholder="TR00 0000 0000 0000 0000 0000 00" />
            </FormField>
            {agreement?.hasIban ? (
              <label className="flex items-center gap-2 text-xs text-text-muted sm:col-span-2">
                <input type="checkbox" name="iban_clear" value="1" className="h-4 w-4 touch:h-5 touch:w-5" /> Kayıtlı IBAN&apos;ı sil
              </label>
            ) : null}
            <FormField label="Not" htmlFor="agreement_notes" className="sm:col-span-2">
              <FormTextarea id="agreement_notes" name="notes" rows={2} maxLength={1000} defaultValue={agreement?.notes ?? ""} />
            </FormField>
          </div>
          <FormError error={error} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" loading={pending} icon={Landmark}>Sözleşmeyi kaydet</Button>
            {agreement ? <Button type="button" size="sm" variant="ghost" onClick={() => { setEditing(false); setError(null); }}>Vazgeç</Button> : null}
          </div>
        </form>
      )}
    </section>
  );
}

export type PayoutVM = {
  id: string;
  paidOn: string;
  amount: number;
  method: string;
  reference: string | null;
  note: string | null;
  voidedAt: string | null;
  voidReason: string | null;
};

/** Mülk sahibine ödeme yap: tutar (varsayılan = ödenecek bakiye), tarih, yöntem, dekont no; geçmiş ve iptal. */
export function PayoutPanel({
  rentalId,
  today,
  payable,
  payouts,
  canEdit,
  canDelete,
}: {
  rentalId: string;
  today: string;
  payable: number;
  payouts: PayoutVM[];
  canEdit: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voidFor, setVoidFor] = useState<string | null>(null);

  function submit(fd: FormData) {
    setError(null);
    fd.set("rental_id", rentalId);
    start(async () => {
      const res = await recordOwnerPayout({}, fd);
      if (res.error) {
        setError(res.error);
        return;
      }
      push("Mülk sahibi ödemesi kaydedildi", "ok");
      setOpen(false);
      router.refresh();
    });
  }
  function submitVoid(payoutId: string, fd: FormData) {
    setError(null);
    start(async () => {
      const res = await voidOwnerPayout({ payoutId, rentalId, reason: String(fd.get("reason") ?? "") });
      if (res.error) {
        setError(res.error);
        return;
      }
      push("Ödeme iptal edildi", "ok");
      setVoidFor(null);
      router.refresh();
    });
  }

  return (
    <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
          <Wallet className="h-4 w-4 text-brand-600" /> Mülk sahibine ödemeler
          <span className="text-xs font-normal text-text-faint">{payouts.filter((p) => !p.voidedAt).length} ödeme</span>
        </h2>
        {canEdit && !open ? <Button size="sm" icon={Wallet} onClick={() => setOpen(true)}>Ödeme yap</Button> : null}
      </div>

      {open ? (
        <form action={submit} className="mt-4 space-y-3 rounded-[var(--radius-card)] border border-brand-300/50 bg-canvas p-3" aria-label="Mülk sahibi ödeme formu">
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Tutar (₺)" htmlFor="payout_amount" required hint={`Ödenecek bakiye: ${money(payable)}`}>
              <FormInput id="payout_amount" name="amount" inputMode="decimal" required defaultValue={payable > 0 ? String(payable).replace(".", ",") : ""} />
            </FormField>
            <FormField label="Ödeme tarihi" htmlFor="payout_paid_on" required>
              <FormInput id="payout_paid_on" name="paid_on" type="date" required max={today} defaultValue={today} />
            </FormField>
            <FormField label="Yöntem" htmlFor="payout_method" required>
              <FormSelect id="payout_method" name="method" defaultValue="bank_transfer">
                {PAYOUT_METHODS.map((m) => (
                  <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m as PaymentMethod]}</option>
                ))}
              </FormSelect>
            </FormField>
            <FormField label="Dekont no" htmlFor="payout_reference">
              <FormInput id="payout_reference" name="reference" maxLength={60} />
            </FormField>
            <FormField label="Not" htmlFor="payout_note" className="sm:col-span-2">
              <FormInput id="payout_note" name="note" maxLength={300} />
            </FormField>
          </div>
          <label className="flex items-start gap-2 text-xs text-text-muted">
            <input type="checkbox" name="confirm_advance" value="1" className="mt-0.5 h-4 w-4 touch:h-5 touch:w-5" />
            Tutar bakiyeyi aşıyorsa peşin ödeme olarak kaydet (bakiye negatife düşer).
          </label>
          <FormError error={error} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" loading={pending}>Ödemeyi kaydet</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => { setOpen(false); setError(null); }}>Vazgeç</Button>
          </div>
        </form>
      ) : null}

      {payouts.length === 0 ? (
        <p className="mt-4 rounded-[var(--radius-card)] border border-dashed border-line-strong p-5 text-center text-sm text-text-muted">
          Henüz mülk sahibine ödeme kaydı yok.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-line rounded-[var(--radius-card)] border border-line text-sm">
          {payouts.map((p) => {
            const voided = Boolean(p.voidedAt);
            return (
              <li key={p.id} className="space-y-2 px-3 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className={voided ? "text-text-faint line-through" : "text-ink-950"}>
                    <span className="numeric font-bold">{money(p.amount)}</span>
                    <span className="ml-2 text-xs text-text-muted">
                      {dayLabel(p.paidOn)} · {PAYMENT_METHOD_LABELS[p.method as PaymentMethod] ?? p.method}
                      {p.reference ? ` · dekont ${p.reference}` : ""}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {voided ? <Badge variant="outline" size="sm">İptal edildi</Badge> : null}
                    {!voided && canDelete ? (
                      <Button size="sm" variant="ghost" onClick={() => { setVoidFor(voidFor === p.id ? null : p.id); setError(null); }}>İptal et</Button>
                    ) : null}
                  </div>
                </div>
                {p.note ? <p className="text-xs text-text-muted">{p.note}</p> : null}
                {voided && p.voidReason ? <p className="text-xs text-text-muted">İptal nedeni: {p.voidReason}</p> : null}
                {voidFor === p.id ? (
                  <form action={(fd) => submitVoid(p.id, fd)} className="space-y-2 rounded-[var(--radius-control)] bg-canvas p-2.5">
                    <FormField label="İptal nedeni" htmlFor={`void-${p.id}`} required hint="Denetim kaydına yazılır; ödeme silinmez, iptal edilir.">
                      <FormInput id={`void-${p.id}`} name="reason" required minLength={3} maxLength={300} />
                    </FormField>
                    <FormError error={error} />
                    <div className="flex gap-2">
                      <Button type="submit" size="sm" variant="danger" loading={pending}>Ödemeyi iptal et</Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setVoidFor(null)}>Vazgeç</Button>
                    </div>
                  </form>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export type ChargeCandidateVM = { kind: "expense" | "due"; id: string; date: string; label: string; amount: number; linked: boolean };

/** Mülke ait gider/aidatı hakedişe yansıt (mülk sahibinden düşülür) ya da geri al. */
export function ChargeLinksPanel({ rentalId, candidates, canEdit }: { rentalId: string; candidates: ChargeCandidateVM[]; canEdit: boolean }) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  function toggle(c: ChargeCandidateVM) {
    setBusy(`${c.kind}:${c.id}`);
    start(async () => {
      const res = await setOwnerCharge({ rentalId, kind: c.kind, refId: c.id, link: !c.linked });
      setBusy(null);
      if (res.error) push(res.error, "err");
      else {
        push(c.linked ? "Yansıtma geri alındı" : "Kalem hakedişe yansıtıldı", "ok");
        router.refresh();
      }
    });
  }

  return (
    <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
      <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
        <Link2 className="h-4 w-4 text-brand-600" /> Mülke ait gider &amp; aidat
      </h2>
      <p className="mt-1 text-xs text-text-muted">
        Yansıttığınız kalem hakedişten düşülür ve ofis kâr/zararında gider sayılmaz (mülk sahibinden geri alınır). Yansıtılmayanlar ofis gideri olarak kalır.
      </p>
      {candidates.length === 0 ? (
        <p className="mt-4 rounded-[var(--radius-card)] border border-dashed border-line-strong p-5 text-center text-sm text-text-muted">
          Bu portföye bağlı gider veya aidat kaydı yok. Giderler ve Aidat ekranından kaydı bu portföye bağlayın.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-line rounded-[var(--radius-card)] border border-line text-sm">
          {candidates.map((c) => (
            <li key={`${c.kind}:${c.id}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate font-medium text-ink-950">{c.label}</p>
                <p className="text-xs text-text-muted">{dayLabel(c.date)} · {c.kind === "due" ? "Aidat" : "Gider"}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="numeric font-bold text-ink-950">{money(c.amount)}</span>
                {canEdit ? (
                  <Button
                    size="sm"
                    variant={c.linked ? "ghost" : "outline"}
                    icon={c.linked ? Link2Off : Link2}
                    loading={pending && busy === `${c.kind}:${c.id}`}
                    onClick={() => toggle(c)}
                  >
                    {c.linked ? "Geri al" : "Hakedişe yansıt"}
                  </Button>
                ) : c.linked ? (
                  <Badge variant="info" size="sm">Yansıtıldı</Badge>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
