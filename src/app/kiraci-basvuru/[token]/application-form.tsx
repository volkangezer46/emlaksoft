"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, FileUp, Loader2, Send, ShieldCheck, UserRound, Users } from "lucide-react";
import {
  finalizeApplicationUpload,
  prepareApplicationUpload,
  submitRentalApplication,
} from "@/app/actions/rental-applications-public";
import { uploadToDirectFileTarget } from "@/lib/direct-file-upload-client";
import { FormField, FormInput, FormSelect, FormTextarea } from "@/components/ui/form-controls";
import { PhoneInput } from "@/components/ui/phone-input";
import { EmailInput } from "@/components/ui/email-input";
import { FileInput } from "@/components/ui/file-input";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { AFFORDABILITY_LABELS, affordability, ratioLabel, rentToIncomeRatio } from "@/lib/rentals/applications";
import { parseLooseNumber } from "@/lib/form-tabs";

type Doc = { type: string; label: string; hint: string | null };

const TONE = {
  comfortable: "text-mint-700",
  borderline: "text-amber-700",
  risky: "text-danger-600",
  unknown: "text-text-muted",
} as const;

/**
 * Kiracı başvuru formu (mobil öncelikli, tek sütun, ≥44px hedefler). İki adım:
 * 1) bilgiler + kefil + KVKK → kayıt; 2) evrak yükleme (isteğe bağlı, sonra da ofise iletilebilir).
 * Sonuç sayfa yenilenmeden gösterilir; dosya doğrudan özel depoya gider, sunucu baytları doğrular.
 */
export function ApplicationForm({
  token,
  today,
  monthlyRent,
  docs,
  kvkkHref,
  officeName,
}: {
  token: string;
  today: string;
  monthlyRent: number | null;
  docs: Doc[];
  kvkkHref: string;
  officeName: string;
}) {
  const [step, setStep] = useState<"form" | "docs" | "done" | "duplicate">("form");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [phone, setPhone] = useState("");
  const [gPhone, setGPhone] = useState("");
  const [income, setIncome] = useState("");
  const [pets, setPets] = useState(false);
  const [withGuarantor, setWithGuarantor] = useState(true);
  const [kvkk, setKvkk] = useState(false);
  const [session, setSession] = useState<{ applicationId: string; uploadKey: string } | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const incomeNum = parseLooseNumber(income);
  const ratio = rentToIncomeRatio(monthlyRent, incomeNum);
  const aff = affordability(ratio);

  function submit(fd: FormData) {
    setError(null);
    fd.set("token", token);
    if (!withGuarantor) {
      for (const k of ["guarantor_name", "guarantor_phone", "guarantor_relation", "guarantor_occupation", "guarantor_income", "guarantor_address"]) fd.delete(k);
    }
    start(async () => {
      const res = await submitRentalApplication(fd);
      if (res.error) {
        setError(res.error);
        return;
      }
      if (res.duplicate) {
        setStep("duplicate");
        return;
      }
      if (res.applicationId && res.uploadKey) {
        setSession({ applicationId: res.applicationId, uploadKey: res.uploadKey });
        setStep("docs");
      } else setStep("done");
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  async function upload(docType: string, file: File | undefined) {
    if (!file || !session) return;
    setError(null);
    setBusy(docType);
    try {
      const prepared = await prepareApplicationUpload(token, session.applicationId, session.uploadKey, {
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        docType,
      });
      if (!prepared.ok) {
        setError(prepared.error);
        return;
      }
      const up = await uploadToDirectFileTarget(prepared.upload, file);
      if (!up.ok) {
        setError(up.error);
        return;
      }
      const done = await finalizeApplicationUpload(token, session.applicationId, session.uploadKey, prepared.upload.sessionId);
      if (!done.ok) {
        setError(done.error ?? "Dosya doğrulanamadı.");
        return;
      }
      setCounts((c) => ({ ...c, [docType]: (c[docType] ?? 0) + 1 }));
    } catch {
      setError("Yükleme sırasında bir sorun oluştu. Lütfen tekrar deneyin.");
    } finally {
      setBusy(null);
    }
  }

  if (step === "done" || step === "duplicate") {
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    return (
      <div className="mt-5 rounded-[var(--radius-card)] border border-mint-500/30 bg-mint-500/8 px-4 py-8 text-center" role="status">
        <CheckCircle2 className="mx-auto h-10 w-10 text-mint-600" aria-hidden="true" />
        <h2 className="mt-3 font-display text-lg font-bold text-ink-950">
          {step === "duplicate" ? "Başvurunuz zaten alınmış" : "Başvurunuz alındı"}
        </h2>
        <p className="mx-auto mt-1 max-w-prose text-sm text-text-muted">
          {step === "duplicate"
            ? `Bu telefonla bu ilana daha önce başvurdunuz. ${officeName} sizinle iletişime geçecek.`
            : `${officeName} başvurunuzu inceleyip ev sahibine sunacak.${total > 0 ? ` ${total} belge iletildi.` : " Belgelerinizi daha sonra ofise de iletebilirsiniz."}`}
        </p>
      </div>
    );
  }

  if (step === "docs") {
    return (
      <div className="mt-5 space-y-4">
        <div className="rounded-[var(--radius-card)] border border-mint-500/30 bg-mint-500/8 px-4 py-3 text-sm" role="status">
          <p className="flex items-center gap-2 font-bold text-ink-950">
            <CheckCircle2 className="h-4 w-4 text-mint-600" aria-hidden="true" /> Bilgileriniz kaydedildi
          </p>
          <p className="mt-1 text-text-muted">
            Son adım: belgelerinizi ekleyin. Belgeli başvurular ev sahibine öncelikle sunulur. İsterseniz bu adımı atlayabilirsiniz.
          </p>
        </div>
        <ul className="space-y-3">
          {docs.map((d) => (
            <li key={d.type} className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-bold text-ink-950">{d.label}</p>
                <span className={`text-xs font-semibold ${(counts[d.type] ?? 0) > 0 ? "text-mint-700" : "text-text-muted"}`}>
                  {(counts[d.type] ?? 0) > 0 ? `${counts[d.type]} dosya yüklendi` : "İsteğe bağlı"}
                </span>
              </div>
              {d.hint ? <p className="mt-1 text-xs text-text-muted">{d.hint}</p> : null}
              <div className="mt-3">
                {busy === d.type ? (
                  <span className="inline-flex min-h-11 items-center gap-2 text-xs font-semibold text-text-muted">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Yükleniyor ve doğrulanıyor
                  </span>
                ) : (
                  <FileInput
                    aria-label={`${d.label} dosyası seç`}
                    accept="image/jpeg,image/png,image/webp,application/pdf"
                    disabled={busy !== null}
                    buttonLabel="Fotoğraf çek veya dosya seç"
                    emptyLabel="JPG, PNG, WEBP veya PDF · en çok 10 MB"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      void upload(d.type, file);
                      e.target.value = "";
                    }}
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
        {error ? <p role="alert" className="rounded-[var(--radius-control)] bg-danger-500/8 px-3 py-2 text-sm font-medium text-danger-600">{error}</p> : null}
        <Button size="lg" className="min-h-12 w-full" icon={Send} disabled={busy !== null} onClick={() => setStep("done")}>
          Başvuruyu tamamla
        </Button>
      </div>
    );
  }

  return (
    <form action={submit} className="mt-5 space-y-6">
      {/* Honeypot: gerçek kullanıcı görmez; dolu gelirse kayıt sessizce yutulur. */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute left-[-9999px] h-0 w-0 opacity-0" />

      <fieldset className="space-y-4">
        <legend className="flex items-center gap-2 font-display text-base font-bold text-ink-950">
          <UserRound className="h-4 w-4 text-brand-600" aria-hidden="true" /> Sizin bilgileriniz
        </legend>
        <FormField label="Ad soyad" htmlFor="ra-name" required>
          <FormInput name="full_name" required autoComplete="name" maxLength={160} placeholder="Örn. Ayşe Yıldız" />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Cep telefonu" htmlFor="ra-phone" required>
            <PhoneInput name="phone" required autoComplete="tel-national" value={phone} onValueChange={setPhone} />
          </FormField>
          <FormField label="E-posta" htmlFor="ra-email" hint="İsteğe bağlı">
            <EmailInput name="email" maxLength={254} placeholder="ornek@eposta.com" />
          </FormField>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Meslek" htmlFor="ra-occupation">
            <FormInput name="occupation" maxLength={120} placeholder="Örn. Öğretmen" />
          </FormField>
          <FormField label="Çalıştığınız kurum" htmlFor="ra-employer">
            <FormInput name="employer" maxLength={160} placeholder="Örn. Özel sektör / kamu" />
          </FormField>
        </div>
        <FormField
          label="Aylık net gelir (TL)"
          htmlFor="ra-income"
          hint={
            ratio != null ? (
              <span className={TONE[aff]}>
                Kira gelirinizin {ratioLabel(ratio)}&apos;i · {AFFORDABILITY_LABELS[aff]}
              </span>
            ) : (
              "Ev sahipleri genelde kiranın gelirin üçte birini aşmamasını ister."
            )
          }
        >
          <FormInput name="monthly_income" inputMode="decimal" autoComplete="off" placeholder="Örn. 60.000" value={income} onChange={(e) => setIncome(e.target.value)} />
        </FormField>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="font-display text-base font-bold text-ink-950">Ev ve taşınma</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Evde kaç kişi yaşayacak?" htmlFor="ra-household">
            <FormSelect name="household_size" defaultValue="">
              <option value="">Seçin</option>
              {Array.from({ length: 8 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>{n === 8 ? "8 ve üzeri" : `${n} kişi`}</option>
              ))}
            </FormSelect>
          </FormField>
          <FormField label="Taşınmak istediğiniz tarih" htmlFor="ra-movein">
            <FormInput type="date" name="move_in_date" min={today} />
          </FormField>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[var(--radius-card)] border border-line bg-canvas/60 px-3.5 py-2.5 text-sm text-ink-950">
            <Checkbox name="has_pets" checked={pets} onChange={(e) => setPets(e.target.checked)} /> Evcil hayvanım var
          </label>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[var(--radius-card)] border border-line bg-canvas/60 px-3.5 py-2.5 text-sm text-ink-950">
            <Checkbox name="smoker" /> Sigara içiyorum
          </label>
        </div>
        {pets ? (
          <FormField label="Evcil hayvan" htmlFor="ra-pets">
            <FormInput name="pets_note" maxLength={200} placeholder="Örn. 1 kedi, kısırlaştırılmış" />
          </FormField>
        ) : null}
        <FormField label="Ev sahibine iletmek istedikleriniz" htmlFor="ra-message" hint="İsteğe bağlı · en çok 1000 karakter">
          <FormTextarea name="message" rows={3} maxLength={1000} placeholder="Örn. Uzun süreli oturmak istiyoruz, depozito hazır." />
        </FormField>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="flex items-center gap-2 font-display text-base font-bold text-ink-950">
          <Users className="h-4 w-4 text-brand-600" aria-hidden="true" /> Kefil
        </legend>
        <p className="-mt-2 text-xs text-text-muted">Ev sahiplerinin çoğu kefil ister. Kefilli başvurular öne çıkar.</p>
        <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[var(--radius-card)] border border-line bg-canvas/60 px-3.5 py-2.5 text-sm font-semibold text-ink-950">
          <Checkbox checked={withGuarantor} onChange={(e) => setWithGuarantor(e.target.checked)} /> Kefil bilgisi ekleyeceğim
        </label>
        {withGuarantor ? (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Kefil ad soyad" htmlFor="ra-g-name">
                <FormInput name="guarantor_name" maxLength={160} autoComplete="off" />
              </FormField>
              <FormField label="Kefil telefonu" htmlFor="ra-g-phone">
                <PhoneInput name="guarantor_phone" autoComplete="off" value={gPhone} onValueChange={setGPhone} />
              </FormField>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <FormField label="Yakınlık" htmlFor="ra-g-rel">
                <FormInput name="guarantor_relation" maxLength={80} placeholder="Örn. Babası" />
              </FormField>
              <FormField label="Kefil mesleği" htmlFor="ra-g-occ">
                <FormInput name="guarantor_occupation" maxLength={120} />
              </FormField>
              <FormField label="Kefil aylık geliri (TL)" htmlFor="ra-g-income">
                <FormInput name="guarantor_income" inputMode="decimal" placeholder="Örn. 80.000" />
              </FormField>
            </div>
            <FormField label="Kefil adresi" htmlFor="ra-g-addr" hint="Sözleşmede kefil adresi olarak yer alır.">
              <FormTextarea name="guarantor_address" rows={2} maxLength={500} />
            </FormField>
          </div>
        ) : null}
      </fieldset>

      <div className="rounded-[var(--radius-card)] border border-line bg-canvas p-4 text-xs leading-relaxed text-text-muted">
        <p className="flex items-start gap-2">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden="true" />
          <span>
            Bilgileriniz yalnızca bu kiralama başvurusunun değerlendirilmesi için {officeName} tarafından işlenir, ev sahibiyle
            yalnız değerlendirme amacıyla paylaşılır ve sonuçlanmayan başvurular 180 gün sonra silinir.{" "}
            <a href={kvkkHref} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-600 underline underline-offset-2">
              Aydınlatma metnini aç
            </a>
          </span>
        </p>
        <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-3 text-sm font-semibold text-ink-950">
          <Checkbox name="kvkk" required checked={kvkk} onChange={(e) => setKvkk(e.target.checked)} />
          Aydınlatma metnini okudum, başvurum için verilerimin işlenmesini kabul ediyorum
        </label>
      </div>

      {error ? <p role="alert" className="rounded-[var(--radius-control)] bg-danger-500/8 px-3 py-2 text-sm font-medium text-danger-600">{error}</p> : null}

      <Button type="submit" size="lg" className="min-h-12 w-full" loading={pending} disabled={!kvkk} icon={FileUp}>
        Başvurumu gönder
      </Button>
    </form>
  );
}
