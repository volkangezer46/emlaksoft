"use client";

import { useState, useTransition } from "react";
import type { FormEvent, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import {
  saveAdvisorPrivate,
  saveAdvisorRegions,
  saveAdvisorSpecialties,
  saveAdvisorWorkProfile,
  type AdvisorProfileResult,
} from "@/app/actions/advisor-profile";
import { useToast } from "@/components/app/toast-provider";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  EmploymentFields,
  PersonalFields,
  RegionsField,
  SpecialtiesField,
} from "@/app/app/ekip/yeni/advisor-extra-fields";
import type {
  PrivateSummary,
  RegionView,
  SpecialtyOptions,
  SpecialtyView,
  WorkProfileRow,
} from "@/lib/advisor/advisor-profile";
import { maskIban, maskTc } from "@/lib/advisor/pii-mask";
import { PiiReveal } from "./pii-reveal";

type GeoOption = { id: string; name: string };

/** Ortak kaydetme kabuğu: tek `<form>`, hatada alanlar korunur, başarıda sayfa verisi tazelenir. */
function EditorForm({
  run,
  children,
  submitLabel,
  disabledReason,
}: {
  run: (fd: FormData) => Promise<AdvisorProfileResult>;
  children: ReactNode;
  submitLabel: string;
  disabledReason?: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { push } = useToast();
  const router = useRouter();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    startTransition(async () => {
      const res = await run(fd);
      if (res.error) {
        setError(res.error);
        return;
      }
      setError(null);
      push(res.message ?? "Kaydedildi", "ok");
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" icon={Save} loading={pending} disabled={pending || !!disabledReason}>
          {submitLabel}
        </Button>
        {disabledReason ? <span className="text-xs text-text-muted">{disabledReason}</span> : null}
      </div>
    </form>
  );
}

export function WorkProfileEditor({ profileId, defaults }: { profileId: string; defaults: WorkProfileRow | null }) {
  return (
    <EditorForm run={(fd) => saveAdvisorWorkProfile(profileId, fd)} submitLabel="İş profilini kaydet">
      <EmploymentFields defaults={defaults} />
    </EditorForm>
  );
}

export function PrivateEditor({
  profileId,
  piiEnabled,
  provinces,
  defaults,
}: {
  profileId: string;
  piiEnabled: boolean;
  provinces: GeoOption[];
  defaults: PrivateSummary | null;
}) {
  const tcMask = maskTc(defaults?.national_id_last4);
  const ibanMask = maskIban(defaults?.iban_last4);
  return (
    <EditorForm run={(fd) => saveAdvisorPrivate(profileId, fd)} submitLabel="Kimlik bilgilerini kaydet">
      <PersonalFields
        provinces={provinces}
        piiEnabled={piiEnabled}
        defaults={defaults}
        tcExtra={
          tcMask ? (
            <>
              {piiEnabled ? (
                <PiiReveal profileId={profileId} field="national_id" masked={tcMask} label="Kayıtlı TC" />
              ) : (
                <p className="mt-2 text-xs text-text-muted">Kayıtlı TC: <span className="numeric font-semibold">{tcMask}</span></p>
              )}
              <label className="mt-2 flex items-center gap-2 text-xs text-text-muted">
                <input type="checkbox" name="clear_national_id" value="1" className="accent-[var(--brand-600)]" /> Kayıtlı TC kimlik numarasını sil
              </label>
            </>
          ) : null
        }
        ibanExtra={
          ibanMask ? (
            <>
              {piiEnabled ? (
                <PiiReveal profileId={profileId} field="iban" masked={ibanMask} label="Kayıtlı IBAN" />
              ) : (
                <p className="mt-2 text-xs text-text-muted">Kayıtlı IBAN: <span className="numeric font-semibold">{ibanMask}</span></p>
              )}
              <label className="mt-2 flex items-center gap-2 text-xs text-text-muted">
                <input type="checkbox" name="clear_iban" value="1" className="accent-[var(--brand-600)]" /> Kayıtlı IBAN&apos;ı sil
              </label>
            </>
          ) : null
        }
      />
    </EditorForm>
  );
}

export function SpecialtiesEditor({
  profileId,
  options,
  defaults,
}: {
  profileId: string;
  options: SpecialtyOptions;
  defaults: SpecialtyView[];
}) {
  return (
    <EditorForm run={(fd) => saveAdvisorSpecialties(profileId, String(fd.get("specialties_json") ?? "[]"))} submitLabel="Uzmanlıkları kaydet">
      <SpecialtiesField options={options} defaults={defaults} />
    </EditorForm>
  );
}

export function RegionsEditor({
  profileId,
  provinces,
  defaults,
}: {
  profileId: string;
  provinces: GeoOption[];
  defaults: RegionView[];
}) {
  return (
    <EditorForm run={(fd) => saveAdvisorRegions(profileId, String(fd.get("regions_json") ?? "[]"))} submitLabel="Bölgeleri kaydet">
      <RegionsField provinces={provinces} defaults={defaults} />
    </EditorForm>
  );
}
