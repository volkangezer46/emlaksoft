"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Wallet } from "lucide-react";
import { saveExpensesCashSetup, type ExpensesCashSetupInput } from "@/app/actions/setup-finance";
import { useToast } from "@/components/app/toast-provider";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormError, FormField, FormInput, FormSelect } from "@/components/ui/form-controls";
import { PORTAL_KEYS, PORTAL_LABEL, type PortalKey } from "@/lib/finance/portal-roi";

/**
 * Kurulum sihirbazı "Giderler ve kasa" adımı: işyeri (kira ya da kendi işyeri), muhasebe ücreti, SGK, portal üyelikleri,
 * maaşlar (yalnız ofis sahibi/genel müdür), ofis kasası + banka hesabı açılışı -> tek tıkla hesaplar + düzenli ödemeler.
 * Hepsi isteğe bağlıdır; boş bırakılan satır kurulmaz. Geçmişe dönük kayıt açılmaz. "Sonra yaparım" sihirbazın kendi düğmesindedir.
 */
export function GiderlerKasaStep({ canEdit, canSalary, nextHref }: { canEdit: boolean; canSalary: boolean; nextHref: string }) {
  const router = useRouter();
  const { push } = useToast();
  const [workplace, setWorkplace] = useState<"rent" | "own">("rent");
  const [rentPeriod, setRentPeriod] = useState<"monthly" | "yearly">("monthly");
  const [mode, setMode] = useState<"auto" | "approve">("auto");
  const [error, setError] = useState<string | null>(null);
  const [warn, setWarn] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  if (!canEdit) {
    return <Alert tone="info">Giderler ve kasa kurulumu için Giderler yetkisi gerekir; ofis yöneticinize iletin.</Alert>;
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const get = (k: string) => String(fd.get(k) ?? "");
    const portals: Partial<Record<PortalKey, string>> = {};
    for (const k of PORTAL_KEYS) portals[k] = get(`portal_${k}`);
    const input: ExpensesCashSetupInput = {
      workplace,
      rentAmount: get("rentAmount"),
      rentPeriod,
      rentDay: get("rentDay"),
      rentMonth: get("rentMonth"),
      accountingAmount: get("accountingAmount"),
      accountingDay: get("accountingDay"),
      sgkAmount: get("sgkAmount"),
      sgkDay: get("sgkDay"),
      portals,
      portalDay: get("portalDay"),
      salaryAmount: canSalary ? get("salaryAmount") : "",
      salaryDay: get("salaryDay"),
      cashOpening: get("cashOpening"),
      bankName: get("bankName"),
      bankOpening: get("bankOpening"),
      mode,
    };
    setBusy(true);
    setError(null);
    setWarn([]);
    const res = await saveExpensesCashSetup(input);
    setBusy(false);
    if (res.error) return setError(res.error);
    if (res.failed && res.failed.length > 0) {
      setWarn(res.failed);
      push("Bazı satırlar kurulamadı", "err");
      router.refresh();
      return;
    }
    push(res.created ? `${res.created} düzenli ödeme kuruldu` : "Kaydedildi", "ok");
    router.push(nextHref);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="grid gap-5">
      <Fieldset title="İşyeri" hint="Kira ödüyorsanız tutarı ve günü girin; kendi işyeriniz ise kira kurulmaz.">
        <div role="radiogroup" aria-label="İşyeri durumu" className="inline-flex w-fit rounded-[var(--radius-control)] border border-line bg-canvas p-0.5">
          {([["rent", "Kira ödüyoruz"], ["own", "Kendi işyerimiz"]] as const).map(([v, label]) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={workplace === v}
              onClick={() => setWorkplace(v)}
              className={`focus-ring rounded-[var(--radius-control)] px-3 py-1 text-sm font-semibold transition ${workplace === v ? "bg-surface text-ink-950 shadow-[var(--shadow-xs)]" : "text-text-muted"}`}
            >
              {label}
            </button>
          ))}
        </div>
        {workplace === "rent" ? (
          <div className="grid gap-3 sm:grid-cols-4">
            <FormField label="Kira tutarı" htmlFor="gk-rent"><FormInput id="gk-rent" name="rentAmount" inputMode="decimal" placeholder="45.000" /></FormField>
            <FormField label="Ödeme sıklığı" htmlFor="gk-rent-period">
              <FormSelect id="gk-rent-period" value={rentPeriod} onChange={(e) => setRentPeriod(e.target.value as "monthly" | "yearly")}>
                <option value="monthly">Aylık</option>
                <option value="yearly">Yıllık</option>
              </FormSelect>
            </FormField>
            <FormField label="Ayın kaçı?" htmlFor="gk-rent-day" hint="31 = ayın son günü"><FormInput id="gk-rent-day" name="rentDay" type="number" min={1} max={31} defaultValue={1} /></FormField>
            {rentPeriod === "yearly" ? (
              <FormField label="Hangi ay?" htmlFor="gk-rent-month"><FormInput id="gk-rent-month" name="rentMonth" type="number" min={1} max={12} defaultValue={1} /></FormField>
            ) : null}
          </div>
        ) : null}
      </Fieldset>

      <Fieldset title="Muhasebe ve SGK" hint="Aylık ödediğiniz tutarlar; bilmiyorsanız boş bırakın.">
        <div className="grid gap-3 sm:grid-cols-4">
          <FormField label="Muhasebe ücreti" htmlFor="gk-acc"><FormInput id="gk-acc" name="accountingAmount" inputMode="decimal" placeholder="3.500" /></FormField>
          <FormField label="Ayın kaçı?" htmlFor="gk-acc-day"><FormInput id="gk-acc-day" name="accountingDay" type="number" min={1} max={31} defaultValue={5} /></FormField>
          <FormField label="SGK" htmlFor="gk-sgk"><FormInput id="gk-sgk" name="sgkAmount" inputMode="decimal" placeholder="12.000" /></FormField>
          <FormField label="Ayın kaçı?" htmlFor="gk-sgk-day"><FormInput id="gk-sgk-day" name="sgkDay" type="number" min={1} max={31} defaultValue={26} /></FormField>
        </div>
      </Fieldset>

      <Fieldset title="Portal üyelikleri" hint="Aylık ödediğiniz üyelik tutarı; üyeliğiniz olmayan portalı boş bırakın. Portal getirisi hesabına bağlanır.">
        <div className="grid gap-3 sm:grid-cols-5">
          {PORTAL_KEYS.map((k) => (
            <FormField key={k} label={PORTAL_LABEL[k]} htmlFor={`gk-portal-${k}`}>
              <FormInput id={`gk-portal-${k}`} name={`portal_${k}`} inputMode="decimal" placeholder="Tutar" />
            </FormField>
          ))}
          <FormField label="Ayın kaçı?" htmlFor="gk-portal-day"><FormInput id="gk-portal-day" name="portalDay" type="number" min={1} max={31} defaultValue={1} /></FormField>
        </div>
      </Fieldset>

      {canSalary ? (
        <Fieldset title="Maaşlar" hint="Toplam aylık maaş gideri. Yalnız ofis sahibi ve genel müdür görür.">
          <div className="grid gap-3 sm:grid-cols-4">
            <FormField label="Toplam maaş" htmlFor="gk-salary"><FormInput id="gk-salary" name="salaryAmount" inputMode="decimal" placeholder="120.000" /></FormField>
            <FormField label="Ayın kaçı?" htmlFor="gk-salary-day"><FormInput id="gk-salary-day" name="salaryDay" type="number" min={1} max={31} defaultValue={1} /></FormField>
          </div>
        </Fieldset>
      ) : null}

      <Fieldset title="Ofis kasası ve banka" hint="Açılış bakiyesi bugünden itibaren sayılır; ödemeler banka (yoksa kasa) hesabından yazılır.">
        <div className="grid gap-3 sm:grid-cols-4">
          <FormField label="Kasadaki nakit" htmlFor="gk-cash"><FormInput id="gk-cash" name="cashOpening" inputMode="decimal" placeholder="0,00" /></FormField>
          <FormField label="Banka hesabı adı" htmlFor="gk-bank" hint="ör. İş Bankası Kadıköy"><FormInput id="gk-bank" name="bankName" maxLength={80} /></FormField>
          <FormField label="Bankadaki bakiye" htmlFor="gk-bank-open"><FormInput id="gk-bank-open" name="bankOpening" inputMode="decimal" placeholder="0,00" /></FormField>
        </div>
      </Fieldset>

      <FormField label="Ödemeler nasıl işlensin?" htmlFor="gk-mode" hint={mode === "approve" ? "Vade gelince size sorulur; onaylayınca kaydedilir." : "Vade gününde hesaba kendiliğinden işlenir."}>
        <FormSelect id="gk-mode" value={mode} onChange={(e) => setMode(e.target.value as "auto" | "approve")}>
          <option value="auto">Otomatik kaydet</option>
          <option value="approve">Bana sor</option>
        </FormSelect>
      </FormField>

      <FormError error={error} nextStep={null} />
      {warn.length > 0 ? (
        <Alert tone="warning">
          <ul className="list-disc pl-4">{warn.map((w) => <li key={w}>{w}</li>)}</ul>
        </Alert>
      ) : null}
      <div>
        <Button type="submit" variant="primary" icon={Wallet} loading={busy}>Kaydet ve devam et</Button>
      </div>
    </form>
  );
}

function Fieldset({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <fieldset className="grid gap-2 rounded-[var(--radius-card)] border border-line bg-canvas p-4">
      <legend className="px-1 font-display text-sm font-bold text-text">{title}</legend>
      <p className="-mt-1 text-xs text-text-muted">{hint}</p>
      {children}
    </fieldset>
  );
}
