"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Loader2, PartyPopper } from "lucide-react";
import Link from "@/components/ui/smart-link";
import { Alert } from "@/components/ui/alert";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FileInput } from "@/components/ui/file-input";
import { PhoneInput } from "@/components/ui/phone-input";
import { Progress } from "@/components/ui/progress";
import { GeoSelect } from "@/components/app/geo-select";
import { listDistricts } from "@/app/actions/geo";
import { saveOfficeProfile } from "@/app/actions/onboarding-setup";
import { uploadTenantLogo } from "@/app/actions/tenant-logo";
import { saveBrandColor, saveOfficeFocus } from "@/app/actions/profile-complete";
import { TeamStep } from "@/app/app/baslangic/team-step";
import type { GeoOption } from "@/lib/geo/types";
import {
  PROFILE_STEPS,
  profileStepHref,
  profileStepNeighbors,
  type ProfileCompletion,
  type ProfileFacts,
  type ProfileStepKey,
} from "@/lib/profile-completion";
import {
  BRAND_COLOR_PRESETS,
  FIELD,
  FOCUS_SEGMENTS,
  MAX_WORK_DISTRICTS,
  OFFICE_TYPES,
  parseBrandColor,
} from "@/lib/sample-data/office-profile";

const inputCls =
  "focus-ring w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2 text-sm text-text";

function Field({ label, htmlFor, children, hint }: { label: string; htmlFor: string; children: ReactNode; hint?: string }) {
  return (
    <div className="min-w-0">
      <label htmlFor={htmlFor} className="mb-1 block text-xs font-semibold text-text-muted">
        {label}
      </label>
      {children}
      {hint ? <p className="mt-1 text-xs text-text-faint">{hint}</p> : null}
    </div>
  );
}

type Props = {
  step: ProfileStepKey;
  completion: ProfileCompletion;
  facts: ProfileFacts;
  officeName: string;
  provinces: GeoOption[];
  canEdit: boolean;
  canInvite: boolean;
};

/**
 * Ofis profilini tamamlama sihirbazı. Adım URL'de (`?adim=`) durur; her adım KENDİ action'ıyla tek başına kaydedilir
 * ("Kaydet ve devam et"), atlanabilir. Mevcut action'lar yeniden kullanılır: konum/telefon/belge/vergi `saveOfficeProfile`,
 * logo `uploadTenantLogo`, ekip `createAdvisor` (TeamStep); yalnız renk ve odak için yeni `profile-complete` action'ları vardır.
 */
export function ProfileWizard(props: Props) {
  const { step, completion } = props;
  const { prev, next } = profileStepNeighbors(step);
  const meta = PROFILE_STEPS.find((s) => s.key === step)!;
  const nextHref = next ? profileStepHref(next) : "/app";

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-semibold text-text">
              {completion.doneCount} / {completion.total} bilgi tamam
            </p>
            <p className="text-sm font-semibold text-text-muted">%{completion.percent}</p>
          </div>
          <Progress value={completion.percent} label="Ofis profili ilerlemesi" tone={completion.complete ? "success" : "accent"} />
          <nav aria-label="Profil adımları">
            <ol className="flex gap-1 overflow-x-auto pb-1">
              {PROFILE_STEPS.map((s, i) => {
                const left = completion.missingByStep[s.key];
                const current = s.key === step;
                return (
                  <li key={s.key} className="shrink-0">
                    <Link
                      href={profileStepHref(s.key)}
                      aria-current={current ? "step" : undefined}
                      className={
                        "focus-ring flex min-h-9 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition " +
                        (current ? "bg-accent text-white" : left === 0 ? "bg-mint-500/12 text-mint-600" : "bg-line text-text-muted hover:text-text")
                      }
                    >
                      <span aria-hidden>{left === 0 ? <Check className="h-3.5 w-3.5" /> : i + 1}</span>
                      {s.label}
                      {left === 0 ? <span className="sr-only"> (tamamlandı)</span> : <span className="sr-only"> ({left} eksik)</span>}
                    </Link>
                  </li>
                );
              })}
            </ol>
          </nav>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4">
          {completion.complete ? (
            <div className="flex items-center gap-3 rounded-[var(--radius-card)] border border-mint-500/30 bg-mint-500/[0.07] px-4 py-3">
              <PartyPopper className="h-5 w-5 shrink-0 text-mint-600" aria-hidden />
              <p className="text-sm text-text">
                <strong>{props.officeName || "Ofisin"}</strong> profili tamam. Aşağıdan istediğin adımı düzenleyebilirsin.
              </p>
            </div>
          ) : null}
          <div>
            <h2 className="font-display text-lg font-bold text-text">{meta.label}</h2>
            <p className="mt-0.5 text-sm text-text-muted">{meta.description}</p>
          </div>
          <StepBody key={step} {...props} nextHref={nextHref} />
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          {prev ? (
            <ButtonLink href={profileStepHref(prev)} variant="ghost" icon={ArrowLeft}>
              Geri
            </ButtonLink>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {next ? (
            <ButtonLink href={profileStepHref(next)} variant="ghost" iconRight={ArrowRight}>
              Sonra yaparım
            </ButtonLink>
          ) : (
            <ButtonLink href="/app" variant="secondary">
              Ana ekrana dön
            </ButtonLink>
          )}
        </div>
      </div>
    </div>
  );
}

function StepBody(props: Props & { nextHref: string }) {
  if (props.step === "ekip") return <TeamStep canInvite={props.canInvite} nextHref={props.nextHref} />;
  if (!props.canEdit) {
    return <Alert tone="info">Ofis bilgilerini yalnız ayar yetkisi olan kullanıcılar düzenleyebilir. Bu adımı atlayabilirsin.</Alert>;
  }
  switch (props.step) {
    case "konum":
      return <KonumStep {...props} />;
    case "iletisim":
      return <IletisimStep {...props} />;
    case "fatura":
      return <FaturaStep {...props} />;
    case "marka":
      return <MarkaStep {...props} />;
    case "odak":
      return <OdakStep {...props} />;
  }
}

/** Ortak kaydet-ve-devam akışı: eylem hata dönmezse sonraki adıma geçer. */
function useStepSave(nextHref: string) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function run(job: () => Promise<string | null>) {
    setError(null);
    startTransition(async () => {
      const err = await job();
      if (err) return setError(err);
      router.push(nextHref);
      router.refresh();
    });
  }
  return { pending, error, run };
}

function SaveBar({ pending, error }: { pending: boolean; error: string | null }) {
  return (
    <div className="space-y-3 sm:col-span-2">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Button type="submit" loading={pending}>
        Kaydet ve devam et
      </Button>
    </div>
  );
}

function KonumStep({ facts, provinces, nextHref }: Props & { nextHref: string }) {
  const { pending, error, run } = useStepSave(nextHref);
  return (
    <form
      action={(fd) => run(async () => (await saveOfficeProfile(fd)).error ?? null)}
      className="grid grid-cols-1 gap-4 [&>*]:min-w-0"
    >
      <GeoSelect provinces={provinces} defaultProvinceId={facts.provinceId} defaultDistrictId={facts.districtId} withNeighborhood={false} required />
      <Field label="Açık adres" htmlFor="pt-address" hint="Fatura ve vitrin için en az 10 karakter: mahalle, cadde/sokak, bina no.">
        <input id="pt-address" name="address_line" defaultValue={facts.addressLine ?? ""} autoComplete="street-address" placeholder="Kadıköy, Bağdat Cad. No:42" className={inputCls} />
      </Field>
      <SaveBar pending={pending} error={error} />
    </form>
  );
}

function IletisimStep({ facts, nextHref }: Props & { nextHref: string }) {
  const { pending, error, run } = useStepSave(nextHref);
  return (
    <form action={(fd) => run(async () => (await saveOfficeProfile(fd)).error ?? null)} className="grid grid-cols-1 gap-4 sm:grid-cols-2 [&>*]:min-w-0">
      <Field label="Ofis telefonu" htmlFor="pt-phone" hint="Vitrinde ve belgelerde görünür. Sabit hat ya da cep.">
        <PhoneInput id="pt-phone" name="phone" defaultValue={facts.phone ?? ""} className={inputCls} />
      </Field>
      <Field label="Yetki belgesi no" htmlFor="pt-license" hint="Taşınmaz Ticareti Yetki Belgesi numarası.">
        <input id="pt-license" name="license_no" defaultValue={facts.licenseNo ?? ""} autoComplete="off" className={inputCls} />
      </Field>
      <SaveBar pending={pending} error={error} />
    </form>
  );
}

function FaturaStep({ facts, nextHref }: Props & { nextHref: string }) {
  const { pending, error, run } = useStepSave(nextHref);
  return (
    <form action={(fd) => run(async () => (await saveOfficeProfile(fd)).error ?? null)} className="grid grid-cols-1 gap-4 [&>*]:min-w-0">
      <Field label="Vergi no / T.C. kimlik no" htmlFor="pt-tax" hint="Ödeme ve fatura için gerekir; 10 haneli vergi no ya da 11 haneli T.C. kimlik no.">
        <input id="pt-tax" name="tax_number" inputMode="numeric" maxLength={11} defaultValue={facts.taxNumber ?? ""} className={inputCls} placeholder="1234567890" />
      </Field>
      <p className="text-xs text-text-faint">
        Vergi dairesi, IBAN ve diğer fatura ayrıntıları{" "}
        <Link href="/app/ayarlar" className="font-semibold text-brand-600 hover:underline">
          Ayarlar &gt; Marka ve kimlik
        </Link>
        &apos;ten eklenir.
      </p>
      <SaveBar pending={pending} error={error} />
    </form>
  );
}

function MarkaStep({ facts, nextHref }: Props & { nextHref: string }) {
  const { pending, error, run } = useStepSave(nextHref);
  const fileRef = useRef<HTMLInputElement>(null);
  const [color, setColor] = useState(facts.brandColor && parseBrandColor(facts.brandColor) ? facts.brandColor : BRAND_COLOR_PRESETS[0]!.hex);
  const [custom, setCustom] = useState("");
  const effective = parseBrandColor(custom) ?? color;
  return (
    <form
      action={() =>
        run(async () => {
          const file = fileRef.current?.files?.[0];
          if (file && file.size > 0) {
            const fd = new FormData();
            fd.set("logo", file);
            const logo = await uploadTenantLogo(fd);
            if (logo.error) return logo.error;
          }
          const fd = new FormData();
          fd.set(FIELD.brandColor, effective);
          return (await saveBrandColor(fd)).error ?? null;
        })
      }
      className="grid grid-cols-1 gap-5 [&>*]:min-w-0"
    >
      <Field label="Logo (isteğe bağlı)" htmlFor="pt-logo" hint="PNG, JPG veya WebP · en çok 2 MB. Sözleşme, brifing ve portal çıktılarında görünür.">
        <div className="flex items-center gap-3">
          {facts.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- tenant logosu dış depodan gelir
            <img src={facts.logoUrl} alt="Mevcut logo" className="h-12 w-12 rounded-[var(--radius-control)] border border-line object-contain" />
          ) : null}
          <FileInput id="pt-logo" ref={fileRef} accept="image/png,image/jpeg,image/webp" />
        </div>
      </Field>
      <fieldset>
        <legend className="mb-2 text-xs font-semibold text-text-muted">Marka rengi</legend>
        <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Marka rengi">
          {BRAND_COLOR_PRESETS.map((c) => {
            const active = !parseBrandColor(custom) && color === c.hex;
            return (
              <button
                key={c.hex}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={c.label}
                title={c.label}
                onClick={() => {
                  setColor(c.hex);
                  setCustom("");
                }}
                className={`focus-ring grid h-11 w-11 place-items-center rounded-full border-2 transition ${active ? "scale-110 border-ink-950" : "border-transparent hover:scale-105"}`}
                style={{ background: c.hex }}
              >
                {active ? <Check className="h-4 w-4 text-white" /> : null}
              </button>
            );
          })}
          <label className="ml-1 flex items-center gap-2 text-xs text-text-muted">
            Özel
            <input
              type="text"
              value={custom}
              onChange={(e) => setCustom(e.target.value.trim())}
              placeholder="#1d5fd6"
              maxLength={7}
              aria-label="Özel marka rengi (hex)"
              className="focus-ring h-11 w-28 rounded-[var(--radius-control)] border border-line bg-surface px-2 font-mono text-xs"
            />
          </label>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3 rounded-[var(--radius-card)] border border-line bg-canvas p-3" aria-label="Önizleme">
          <p className="text-xs text-text-muted">Düğmeler, vurgular ve vitrin bu renkte görünür.</p>
          <span className="rounded-[var(--radius-control)] px-3 py-1.5 text-xs font-semibold text-white" style={{ background: effective }}>
            Yeni portföy
          </span>
        </div>
      </fieldset>
      <SaveBar pending={pending} error={error} />
    </form>
  );
}

function OdakStep({ facts, provinces, nextHref }: Props & { nextHref: string }) {
  const { pending, error, run } = useStepSave(nextHref);
  const [officeType, setOfficeType] = useState(facts.officeType ?? "bagimsiz");
  const [focus, setFocus] = useState<string[]>([...(facts.focusSegments ?? ["satilik", "kiralik"])]);
  const [picked, setPicked] = useState<string[]>([...(facts.workDistrictIds ?? [])]);
  const [districts, setDistricts] = useState<GeoOption[]>([]);
  const [loading, startLoading] = useTransition();
  const provinceId = facts.provinceId;
  const provinceName = provinces.find((p) => p.id === provinceId)?.name;

  useEffect(() => {
    if (!provinceId) return;
    let stale = false;
    startLoading(async () => {
      const rows = await listDistricts(provinceId);
      if (!stale) setDistricts(rows);
    });
    return () => {
      stale = true;
    };
  }, [provinceId]);

  function toggle<T extends string>(list: T[], v: T, set: (n: T[]) => void, max?: number) {
    if (list.includes(v)) return set(list.filter((x) => x !== v));
    if (max && list.length >= max) return;
    set([...list, v]);
  }

  return (
    <form
      action={() =>
        run(async () => {
          const fd = new FormData();
          fd.set(FIELD.officeType, officeType);
          for (const f of focus) fd.append(FIELD.focus, f);
          for (const d of picked) fd.append(FIELD.workDistricts, d);
          // Boş seçim de gönderilir: kullanıcı odağı/ilçeyi bilerek boşaltmış olabilir.
          if (focus.length === 0) fd.append(FIELD.focus, "");
          if (picked.length === 0) fd.append(FIELD.workDistricts, "");
          return (await saveOfficeFocus(fd)).error ?? null;
        })
      }
      className="grid grid-cols-1 gap-5 [&>*]:min-w-0"
    >
      <fieldset>
        <legend className="mb-2 text-xs font-semibold text-text-muted">Ofis türü</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {OFFICE_TYPES.map((t) => (
            <label key={t.key} className={`flex cursor-pointer flex-col gap-0.5 rounded-[var(--radius-card)] border p-3 text-sm transition ${officeType === t.key ? "border-brand-600 bg-brand-600/[0.05]" : "border-line bg-surface hover:border-brand-300"}`}>
              <span className="flex items-center gap-2 font-semibold text-text">
                <input type="radio" name="pt-office-type" checked={officeType === t.key} onChange={() => setOfficeType(t.key)} className="accent-[var(--brand-600)]" />
                {t.label}
              </span>
              <span className="pl-6 text-xs text-text-muted">{t.description}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-2 text-xs font-semibold text-text-muted">Çalışma alanın (birden fazla seçebilirsin)</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {FOCUS_SEGMENTS.map((f) => {
            const active = focus.includes(f.key);
            return (
              <label key={f.key} className={`flex cursor-pointer flex-col gap-0.5 rounded-[var(--radius-card)] border p-3 text-sm transition ${active ? "border-brand-600 bg-brand-600/[0.05]" : "border-line bg-surface hover:border-brand-300"}`}>
                <span className="flex items-center gap-2 font-semibold text-text">
                  <input type="checkbox" checked={active} onChange={() => toggle(focus, f.key, setFocus)} className="accent-[var(--brand-600)]" />
                  {f.label}
                </span>
                <span className="pl-6 text-xs text-text-muted">{f.description}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-2 text-xs font-semibold text-text-muted">
          Çalıştığın ilçeler{provinceName ? ` (${provinceName})` : ""} <span className="font-normal text-text-faint">en çok {MAX_WORK_DISTRICTS}</span>
        </legend>
        {!provinceId ? (
          <p className="rounded-[var(--radius-card)] border border-dashed border-line px-3.5 py-3 text-xs text-text-muted">
            İlçe seçmek için önce{" "}
            <Link href={profileStepHref("konum")} className="font-semibold text-brand-600 hover:underline">
              Konum adımında ofis ilini
            </Link>{" "}
            seç.
          </p>
        ) : loading ? (
          <p className="flex items-center gap-2 text-xs text-text-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> İlçeler yükleniyor…
          </p>
        ) : (
          <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto rounded-[var(--radius-card)] border border-line p-2" role="group" aria-label="Çalışılan ilçeler">
            {districts.map((d) => {
              const active = picked.includes(d.id);
              return (
                <button
                  key={d.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggle(picked, d.id, setPicked, MAX_WORK_DISTRICTS)}
                  className={`focus-ring min-h-9 rounded-full border px-3 py-1 text-xs font-semibold transition ${active ? "border-brand-600 bg-brand-600 text-white" : "border-line bg-surface text-text-muted hover:border-brand-300"}`}
                >
                  {d.name}
                </button>
              );
            })}
          </div>
        )}
        {picked.length > 0 ? <p className="mt-1.5 text-xs text-text-faint">{picked.length} ilçe seçildi.</p> : null}
      </fieldset>
      <SaveBar pending={pending} error={error} />
    </form>
  );
}
