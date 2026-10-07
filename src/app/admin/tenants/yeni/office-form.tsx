"use client";

import { startTransition, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import Link from "@/components/ui/smart-link";
import {
  ArrowUpRight,
  Building2,
  Check,
  CircleCheck,
  Copy,
  Eye,
  EyeOff,
  House,
  Loader2,
  Lock,
  Plus,
  RotateCcw,
  Sparkles,
  TriangleAlert,
  UserRound,
  Users,
} from "lucide-react";
import { TAB_ICONS as TI } from "@/lib/icons";
import { checkOfficeSlugAvailability, createTenantByAdmin, type CreateOfficeResult, type SlugCheckResult } from "@/app/actions/platform-tenants";
import { GeoSelect } from "@/components/app/geo-select";
import { EmailInput } from "@/components/ui/email-input";
import { FormField, FormInput, FormTextarea, fieldClass } from "@/components/ui/form-controls";
import { PhoneInput } from "@/components/ui/phone-input";
import { SummaryGroup, SummaryRow, TabbedFormShell, type FormTab, type TabbedSummaryContext } from "@/components/ui/tabbed-form-shell";
import {
  OFFICE_ACCESS_MODE_LABELS,
  OFFICE_INITIAL_STATUS_LABELS,
  type OfficeAccessMode,
  type OfficeInitialStatus,
} from "@/lib/admin/office-create-rules";
import { OFFICE_SLUG_MAX, sanitizeSlugTyping, slugifyOffice, validateOfficeSlug } from "@/lib/admin/office-slug";
import { getPlan, isPlanId, normalizeBillingCycle, planAmountTry, PLANS, type PlanDef } from "@/lib/billing/plans";
import { formatPhoneDisplay } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { OFFICE_CREATE_TABS, tabLabelForField } from "./office-tabs";

const TAB_ICONS = { ofis: TI.temel, sahip: TI.kisi, paket: TI.fiyat, fatura: TI.fatura, baslangic: TI.baslangic } as const;

const FIELD_LABELS: Record<string, string> = {
  office_name: "Ofis adı",
  slug: "Vitrin adresi",
  office_phone: "Ofis telefonu",
  province_id: "İl",
  district_id: "İlçe",
  address_line: "Adres",
  license_no: "Yetki belgesi no",
  owner_name: "Sahip adı soyadı",
  owner_email: "Sahip e-postası",
  owner_phone: "Sahip telefonu",
  access_mode: "Erişim yöntemi",
  plan: "Paket",
  billing_cycle: "Faturalama döngüsü",
  initial_status: "Başlangıç durumu",
  tax_office: "Vergi dairesi",
  tax_number: "Vergi numarası",
  seed_sample: "Örnek veri",
};

type Province = { id: string; name: string };

const nf = new Intl.NumberFormat("tr-TR");
const tl = (n: number) => `${nf.format(n)} ₺`;
const limitText = (n: number | null) => (n == null ? "sınırsız" : nf.format(n));

function planLimitTiles(plan: PlanDef): { label: string; value: string; Icon: typeof Users }[] {
  return [
    { label: "Kullanıcı", value: limitText(plan.limits.seats), Icon: Users },
    { label: "Şube", value: limitText(plan.limits.branches), Icon: Building2 },
    { label: "Müşteri", value: limitText(plan.limits.customers), Icon: UserRound },
    { label: "Aktif portföy", value: limitText(plan.limits.activeProperties), Icon: House },
  ];
}

function planLimitLines(plan: PlanDef): [string, string][] {
  return [
    ["Kullanıcı", limitText(plan.limits.seats)],
    ["Şube", limitText(plan.limits.branches)],
    ["Müşteri", limitText(plan.limits.customers)],
    ["Aktif portföy", limitText(plan.limits.activeProperties)],
  ];
}

const planCard =
  "flex h-full flex-col rounded-[var(--radius-card)] border border-line bg-canvas p-4 shadow-[0_1px_2px_rgb(15_23_42/0.04)] transition duration-200 group-hover:-translate-y-0.5 group-hover:border-brand-300 group-hover:shadow-[0_10px_24px_-12px_rgb(30_64_175/0.25)] peer-checked:border-brand-500 peer-checked:bg-gradient-to-b peer-checked:from-brand-600/[0.07] peer-checked:to-transparent peer-checked:ring-2 peer-checked:ring-brand-500/30 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500 motion-reduce:transition-none motion-reduce:group-hover:translate-y-0";

const choiceCard =
  "block h-full rounded-[var(--radius-card)] border border-line bg-canvas p-3.5 transition peer-checked:border-brand-500 peer-checked:bg-brand-600/[0.06] peer-checked:ring-2 peer-checked:ring-brand-500/30 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500 peer-disabled:cursor-not-allowed peer-disabled:opacity-55 group-hover:border-brand-300";

export function OfficeForm({
  provinces,
  canCreateActive,
  trialDays,
}: {
  provinces: Province[];
  canCreateActive: boolean;
  /** Platform politikası (Ayar Kayıt Defteri); formdan değiştirilemez. */
  trialDays: number;
}) {
  const [result, setResult] = useState<CreateOfficeResult | null>(null);
  // "Bir ofis daha ekle": formu sıfırdan kurmak için anahtar değişir (tüm alanlar ve parola bellekten gider).
  const [formKey, setFormKey] = useState(0);

  if (result?.ok && result.tenantId) {
    return (
      <OfficeCreated
        result={result}
        onAnother={() => {
          setResult(null);
          setFormKey((k) => k + 1);
        }}
      />
    );
  }
  return <OfficeFormInner key={formKey} provinces={provinces} canCreateActive={canCreateActive} trialDays={trialDays} onCreated={setResult} />;
}

function OfficeFormInner({
  provinces,
  canCreateActive,
  trialDays,
  onCreated,
}: {
  provinces: Province[];
  canCreateActive: boolean;
  trialDays: number;
  onCreated: (result: CreateOfficeResult) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [officeName, setOfficeName] = useState("");
  // null: vitrin adresi ofis adından otomatik önerilir; metin: kullanıcı elle yazdı.
  const [slugManual, setSlugManual] = useState<string | null>(null);
  const [provinceId, setProvinceId] = useState("");
  const [initialStatus, setInitialStatus] = useState<OfficeInitialStatus>("trial");
  const [checked, setChecked] = useState<{ slug: string; res: SlugCheckResult } | null>(null);

  const slug = slugManual ?? slugifyOffice(officeName);
  const slugCheck = validateOfficeSlug(slug);
  const slugOk = slugCheck.ok;
  const cityName = provinces.find((p) => p.id === provinceId)?.name ?? "";

  // Benzersizlik: yazma durunca (450 ms) salt-okunur action ile denetlenir; sonuç yalnız o adres için geçerlidir.
  useEffect(() => {
    if (!slugOk) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const fd = new FormData();
      fd.set("slug", slug);
      fd.set("city", cityName);
      try {
        const res = await checkOfficeSlugAvailability(fd);
        if (!cancelled) setChecked({ slug, res });
      } catch {
        if (!cancelled) setChecked({ slug, res: { ok: false, error: "Vitrin adresi şu an denetlenemedi." } });
      }
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [slug, slugOk, cityName]);

  const current = checked && checked.slug === slug ? checked.res : null;
  const slugState: "empty" | "invalid" | "checking" | "available" | "taken" | "error" = !slug
    ? "empty"
    : !slugOk
      ? "invalid"
      : !current
        ? "checking"
        : !current.ok
          ? "error"
          : current.available
            ? "available"
            : "taken";

  const tabs: FormTab[] = useMemo(
    () =>
      OFFICE_CREATE_TABS.map((t) => ({
        id: t.id,
        label: t.label,
        description: t.description,
        icon: TAB_ICONS[t.id],
        fields: [...t.fields],
        required: [...t.required],
        // Varsayılanı seçili gelen alanlar isteğe bağlı sekmeyi "tamam" saymaz.
        passive: ["access_mode", "billing_cycle", "initial_status"],
      })),
    [],
  );

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (slugState === "invalid" && !slugCheck.ok) {
      setError(`Ofis bilgileri: ${slugCheck.error}`);
      return;
    }
    if (slugState === "taken") {
      setError(`Ofis bilgileri: "${slug}" vitrin adresi kullanımda. Önerilerden birini seçin ya da farklı bir adres yazın.`);
      return;
    }
    const fd = new FormData(e.currentTarget);
    setError(null);
    setPending(true);
    startTransition(async () => {
      try {
        const res = await createTenantByAdmin(fd);
        if (res.ok && res.tenantId) {
          onCreated(res);
          return;
        }
        const tab = tabLabelForField(res.field);
        setError(`${tab ? `${tab}: ` : ""}${res.error ?? "Ofis açılamadı."}`);
      } catch {
        setError("İşlem sırasında bağlantı kesildi. Ofis listesini kontrol edip tekrar deneyin.");
      } finally {
        setPending(false);
      }
    });
  }

  const tabPanels = {
    ofis: (
      <>
        <FormField label="Ofis adı" htmlFor="office_name" required className="sm:col-span-2" hint="Vitrinde, faturada ve panelde görünen ad.">
          <FormInput
            name="office_name"
            required
            minLength={2}
            maxLength={160}
            autoComplete="off"
            value={officeName}
            onChange={(e) => setOfficeName(e.target.value)}
            placeholder="Kadıköy Emlak Ofisi"
          />
        </FormField>

        <FormField
          label="Vitrin adresi"
          htmlFor="slug"
          className="sm:col-span-2"
          inject={false}
          hint="Yalnız küçük harf, rakam ve tire. Boş bırakılırsa ofis adından üretilir."
        >
          <div className="flex items-stretch gap-2">
            <span className="hidden shrink-0 items-center rounded-[var(--radius-control)] border border-line bg-canvas px-3 text-sm text-text-muted sm:inline-flex">
              /vitrin/
            </span>
            <FormInput
              id="slug"
              name="slug"
              value={slug}
              onChange={(e) => setSlugManual(sanitizeSlugTyping(e.target.value))}
              maxLength={OFFICE_SLUG_MAX}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              aria-describedby="slug-status slug-hint"
              aria-invalid={slugState === "invalid" || slugState === "taken" || undefined}
              className="numeric font-mono"
              placeholder="kadikoy-emlak-ofisi"
            />
            {slugManual !== null ? (
              <button
                type="button"
                onClick={() => setSlugManual(null)}
                title="Ofis adından önerilen adrese dön"
                aria-label="Ofis adından önerilen adrese dön"
                className="focus-ring press inline-flex w-11 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-line bg-canvas text-text-muted transition hover:bg-surface"
              >
                <RotateCcw className="h-4 w-4" aria-hidden />
              </button>
            ) : null}
          </div>
          <div id="slug-status" role="status" aria-live="polite" className="mt-1.5 min-h-5 text-xs font-semibold">
            {slugState === "checking" ? (
              <span className="inline-flex items-center gap-1.5 text-text-muted">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Adres denetleniyor…
              </span>
            ) : slugState === "available" ? (
              <span className="inline-flex items-center gap-1.5 text-mint-700">
                <Check className="h-3.5 w-3.5" aria-hidden /> Bu adres kullanılabilir.
              </span>
            ) : slugState === "taken" ? (
              <span className="text-danger-600">
                Bu adres başka bir ofiste kullanılıyor.
                {current?.suggestions?.length ? (
                  <span className="mt-1 flex flex-wrap items-center gap-1.5 font-medium text-text-muted">
                    Öneriler:
                    {current.suggestions.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setSlugManual(s)}
                        className="focus-ring press rounded-full border border-line bg-surface px-2.5 py-1 font-mono text-xs text-ink-950 transition hover:border-brand-300"
                      >
                        {s}
                      </button>
                    ))}
                  </span>
                ) : null}
              </span>
            ) : slugState === "invalid" && !slugCheck.ok ? (
              <span className="text-danger-600">{slugCheck.error}</span>
            ) : slugState === "error" ? (
              <span className="text-amber-700">{current?.error ?? "Adres denetlenemedi."} Kayıtta yeniden denetlenecek.</span>
            ) : null}
          </div>
        </FormField>

        <FormField label="Ofis telefonu" htmlFor="office_phone">
          <PhoneInput name="office_phone" className={fieldClass} />
        </FormField>
        <FormField label="Yetki belgesi no" htmlFor="license_no" hint="Taşınmaz ticareti yetki belgesi numarası.">
          <FormInput name="license_no" maxLength={40} autoComplete="off" placeholder="3400000" />
        </FormField>

        <div className="sm:col-span-2">
          <GeoSelect
            provinces={provinces}
            withNeighborhood={false}
            onSelectionChange={(sel) => setProvinceId(sel.province_id)}
          />
        </div>

        <FormField label="Adres" htmlFor="address_line" className="sm:col-span-2">
          <FormTextarea name="address_line" rows={2} maxLength={300} placeholder="Mahalle, cadde, bina no, kat" />
        </FormField>
      </>
    ),

    sahip: (
      <>
        <FormField label="Ad soyad" htmlFor="owner_name" required className="sm:col-span-2">
          <FormInput name="owner_name" required minLength={2} maxLength={120} autoComplete="off" placeholder="Ayşe Yılmaz" />
        </FormField>
        <FormField
          label="E-posta"
          htmlFor="owner_email"
          required
          hint="Giriş e-postası. Şifre belirleme bağlantısı bu adrese gider."
        >
          <EmailInput id="owner_email" name="owner_email" required autoComplete="off" placeholder="sahip@ofis.com" />
        </FormField>
        <FormField label="Telefon" htmlFor="owner_phone" hint="Yalnız Türkiye cep numarası (SMS doğrulaması için).">
          <PhoneInput name="owner_phone" className={fieldClass} />
        </FormField>

        <fieldset className="sm:col-span-2">
          <legend className="mb-2 text-sm font-medium text-ink-950">Erişim yöntemi</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="group cursor-pointer">
              <input type="radio" name="access_mode" value="link" defaultChecked className="peer sr-only" />
              <span className={choiceCard}>
                <span className="block text-sm font-bold text-ink-950">{OFFICE_ACCESS_MODE_LABELS.link}</span>
                <span className="mt-1 block text-xs text-text-muted">
                  Sahip, e-postasına gelen tek kullanımlık bağlantıyla kendi şifresini belirler. Parolayı kimse görmez.
                </span>
              </span>
            </label>
            <label className="group cursor-pointer">
              <input type="radio" name="access_mode" value="link_temp" className="peer sr-only" />
              <span className={choiceCard}>
                <span className="block text-sm font-bold text-ink-950">{OFFICE_ACCESS_MODE_LABELS.link_temp}</span>
                <span className="mt-1 block text-xs text-text-muted">
                  E-posta yine gider; ayrıca sunucuda üretilen geçici parola kayıttan sonra BİR KEZ gösterilir.
                </span>
              </span>
            </label>
          </div>
          <p className="mt-2 rounded-[var(--radius-control)] border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-800">
            Geçici parola taslağa, tarayıcı belleğine ve denetim kaydına yazılmaz; yalnızca güvenli bir kanaldan iletin.
          </p>
        </fieldset>
      </>
    ),

    paket: (
      <>
        <fieldset className="sm:col-span-2">
          <legend className="mb-2 text-sm font-medium text-ink-950">
            Paket<span aria-hidden="true" className="ml-0.5 text-danger-500">*</span>
          </legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {PLANS.filter((p) => !p.hidden).map((p) => {
              const yearlyMonthly = Math.round(planAmountTry(p.id, "yearly") / 12);
              return (
                <label key={p.id} className="group relative cursor-pointer">
                  <input type="radio" name="plan" value={p.id} defaultChecked={p.id === "office"} required className="peer sr-only" />
                  <span className={planCard}>
                    <span className="flex items-start justify-between gap-2">
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[0.95rem] font-bold tracking-tight text-ink-950">{p.name}</span>
                          {p.popular ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-amber-400 to-amber-500 px-2 py-0.5 text-xs font-bold text-white shadow-sm">
                              <Sparkles className="size-3" aria-hidden="true" />
                              Önerilen
                            </span>
                          ) : (
                            <span className="rounded-full border border-line bg-surface px-2 py-0.5 text-xs font-semibold text-text-muted">
                              {p.eyebrow.toLocaleLowerCase("tr-TR").replace(/^./, (c) => c.toLocaleUpperCase("tr-TR"))}
                            </span>
                          )}
                        </span>
                        <span className="mt-0.5 block text-xs text-text-muted">{p.blurb}</span>
                      </span>
                      <span
                        aria-hidden="true"
                        className="grid size-5 shrink-0 place-items-center rounded-full border border-line bg-surface text-transparent transition group-has-[input:checked]:border-brand-600 group-has-[input:checked]:bg-brand-600 group-has-[input:checked]:text-white"
                      >
                        <Check className="size-3" strokeWidth={3} />
                      </span>
                    </span>

                    <span className="mt-3 flex items-baseline gap-1">
                      <span className="numeric text-2xl font-bold tracking-tight text-ink-950">{tl(p.monthlyTry)}</span>
                      <span className="text-xs font-medium text-text-muted">/ay · KDV hariç</span>
                    </span>
                    <span className="mt-0.5 block text-xs text-text-muted">
                      Yıllıkta <span className="numeric font-semibold text-brand-700">{tl(yearlyMonthly)}/ay</span> karşılığı
                    </span>

                    <span className="mt-3 grid grid-cols-2 gap-1.5">
                      {planLimitTiles(p).map(({ label, value, Icon }) => (
                        <span key={label} className="flex items-center gap-2 rounded-[var(--radius-control)] border border-line/70 bg-surface/70 px-2 py-1.5">
                          <Icon className="size-3.5 shrink-0 text-brand-600" aria-hidden="true" />
                          <span className="min-w-0 leading-tight">
                            <span className="numeric block text-xs font-bold text-ink-950">{value}</span>
                            <span className="block truncate text-xs text-text-muted">{label}</span>
                          </span>
                        </span>
                      ))}
                    </span>

                    <span className="mt-3 block space-y-1 border-t border-line/70 pt-2.5">
                      {p.features.slice(2, 5).map((f) => (
                        <span key={f} className="flex items-start gap-1.5 text-xs text-text-muted">
                          <Check className="mt-0.5 size-3.5 shrink-0 text-brand-600" aria-hidden="true" />
                          <span className="min-w-0">{f}</span>
                        </span>
                      ))}
                      {p.efCreditsMonthly ? (
                        <span className="flex items-start gap-1.5 text-xs text-text-muted">
                          <Check className="mt-0.5 size-3.5 shrink-0 text-brand-600" aria-hidden="true" />
                          <span className="min-w-0">
                            Aylık <span className="numeric font-semibold text-ink-950">{nf.format(p.efCreditsMonthly)}</span> EmlakFiyatı kontörü
                          </span>
                        </span>
                      ) : null}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-2 text-sm font-medium text-ink-950">Başlangıç durumu</legend>
          <div className="grid gap-2">
            <label className="group cursor-pointer">
              <input
                type="radio"
                name="initial_status"
                value="trial"
                defaultChecked
                onChange={() => setInitialStatus("trial")}
                className="peer sr-only"
              />
              <span className={choiceCard}>
                <span className="block text-sm font-bold text-ink-950">{OFFICE_INITIAL_STATUS_LABELS.trial}</span>
                <span className="mt-0.5 block text-xs text-text-muted">
                  {trialDays} gün ücretsiz; ofis bu sürede istediği an ücretli pakete geçebilir.
                </span>
              </span>
            </label>
            <label className={cn("group", canCreateActive ? "cursor-pointer" : "cursor-not-allowed")}>
              <input
                type="radio"
                name="initial_status"
                value="active"
                disabled={!canCreateActive}
                onChange={() => setInitialStatus("active")}
                className="peer sr-only"
              />
              <span className={choiceCard}>
                <span className="block text-sm font-bold text-ink-950">{OFFICE_INITIAL_STATUS_LABELS.active}</span>
                <span className="mt-0.5 block text-xs text-text-muted">
                  {canCreateActive
                    ? "Ödemesi platform dışında alınmış ofis. Deneme süresi uygulanmaz."
                    : "Doğrudan aktif açmak için faturalama yetkisi gerekir."}
                </span>
              </span>
            </label>
          </div>
        </fieldset>

        <div className="space-y-4">
          {initialStatus === "trial" ? (
            <div className="rounded-[var(--radius-card)] border border-line bg-canvas/60 p-3.5" aria-live="polite">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-text-muted">Deneme süresi</p>
                  <p className="numeric mt-0.5 text-2xl font-bold tracking-tight text-ink-950">{trialDays} gün</p>
                </div>
                <span className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2 py-0.5 text-xs font-semibold text-text-muted">
                  <Lock className="size-3" aria-hidden="true" />
                  Platform kuralı
                </span>
              </div>
              <ul className="mt-2.5 space-y-1 text-xs text-text-muted">
                <li className="flex gap-1.5">
                  <Check className="mt-0.5 size-3.5 shrink-0 text-brand-600" aria-hidden="true" />
                  Her yeni ofise aynı süre tanınır; uzatılmaz, kısaltılmaz.
                </li>
                <li className="flex gap-1.5">
                  <Check className="mt-0.5 size-3.5 shrink-0 text-brand-600" aria-hidden="true" />
                  Ofis süre dolmadan istediği an ücretli pakete geçebilir.
                </li>
                <li className="flex gap-1.5">
                  <Check className="mt-0.5 size-3.5 shrink-0 text-brand-600" aria-hidden="true" />
                  Aylık / yıllık seçimi ödeme sırasında ofis tarafından yapılır.
                </li>
              </ul>
            </div>
          ) : null}

          {initialStatus === "active" ? (
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-ink-950">Faturalama döngüsü</legend>
            <div className="grid grid-cols-2 gap-2">
              <label className="group cursor-pointer">
                <input type="radio" name="billing_cycle" value="monthly" defaultChecked className="peer sr-only" />
                <span className={choiceCard}>
                  <span className="block text-sm font-bold text-ink-950">Aylık</span>
                  <span className="mt-0.5 block text-xs text-text-muted">Her ay ödenir.</span>
                </span>
              </label>
              <label className="group cursor-pointer">
                <input type="radio" name="billing_cycle" value="yearly" className="peer sr-only" />
                <span className={choiceCard}>
                  <span className="block text-sm font-bold text-ink-950">Yıllık</span>
                  <span className="mt-0.5 block text-xs text-text-muted">Yıllık ödemede %20 indirim.</span>
                </span>
              </label>
            </div>
          </fieldset>
          ) : null}
        </div>
      </>
    ),

    fatura: (
      <>
        <FormField label="Vergi dairesi" htmlFor="tax_office">
          <FormInput name="tax_office" maxLength={80} autoComplete="off" placeholder="Kadıköy" />
        </FormField>
        <FormField label="Vergi numarası" htmlFor="tax_number" hint="10 haneli VKN ya da 11 haneli TCKN (şahıs işletmesi).">
          <FormInput name="tax_number" inputMode="numeric" maxLength={11} pattern="[0-9]{10,11}" autoComplete="off" className="numeric" placeholder="1234567890" />
        </FormField>
        <p className="rounded-[var(--radius-control)] border border-line bg-canvas/60 px-3 py-2 text-xs text-text-muted sm:col-span-2">
          Fatura unvanı olarak ofis adı, fatura adresi olarak «Ofis bilgileri» sekmesindeki adres kullanılır. Bu alanlar
          sonradan Ofis 360 &gt; Yönetim sekmesinden de girilebilir.
        </p>
      </>
    ),

    baslangic: (
      <>
        <label className="group flex cursor-pointer items-start gap-3 rounded-[var(--radius-card)] border border-line bg-canvas p-4 sm:col-span-2">
          <input type="checkbox" name="seed_sample" value="1" className="mt-0.5 h-4 w-4 accent-[var(--brand-600)]" />
          <span>
            <span className="block text-sm font-bold text-ink-950">Örnek veriyi yükle</span>
            <span className="mt-0.5 block text-xs text-text-muted">
              6 müşteri, 4 portföy, 3 talep, 4 görev, 2 randevu ve 1 anlaşma. Tümü kurgusaldır ve «örnek» olarak
              işaretlenir; ofis sahibi Ayarlar ekranından tek tıkla temizleyebilir. İşaretlemezseniz ofis boş açılır ve
              sahip ana ekrandaki düğmeyle kendisi yükleyebilir.
            </span>
          </span>
        </label>
        <div className="rounded-[var(--radius-card)] border border-line bg-canvas/60 p-4 text-xs text-text-muted sm:col-span-2">
          <p className="text-sm font-semibold text-ink-950">Varsayılan tanımlar hazır gelir</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-4">
            <li>Sistem tanımları (müşteri türleri, işlem ve portföy türleri, aşama etiketleri, kayıp nedenleri) tüm ofislerde ortaktır.</li>
            <li>Rol ve yetki matrisi varsayılan değerlerle başlar; ofis sahibi Ayarlar &gt; Roller ekranından düzenler.</li>
            <li>Sahip ilk girişte kurulum adımlarını (logo, şube, ekip) kendi panelinden tamamlar.</li>
          </ul>
        </div>
      </>
    ),
  };

  function renderSummary({ values, display }: TabbedSummaryContext) {
    const planId = isPlanId(values.plan ?? "") ? (values.plan as string) : "office";
    const plan = getPlan(planId);
    const cycle = normalizeBillingCycle(values.billing_cycle);
    const status = ((values.initial_status as OfficeInitialStatus | undefined) ?? "trial") as OfficeInitialStatus;
    const mode = ((values.access_mode as OfficeAccessMode | undefined) ?? "link") as OfficeAccessMode;
    const name = (values.office_name ?? "").trim();
    const ownerName = (values.owner_name ?? "").trim();
    const ownerEmail = (values.owner_email ?? "").trim();
    const text = (v: string | undefined) => (v ?? "").trim();
    return (
      <>
        <div className="rounded-[var(--radius-control)] border border-line bg-canvas/60 p-3">
          <p className="text-xs font-semibold text-text-muted">
            {plan.name} · {OFFICE_INITIAL_STATUS_LABELS[status] ?? OFFICE_INITIAL_STATUS_LABELS.trial}
          </p>
          <p className="truncate text-sm font-semibold text-ink-950">{name || "Ofis adı girilmedi"}</p>
          <p className="numeric truncate font-mono text-xs text-text-muted">/vitrin/{slug || "…"}</p>
        </div>

        <SummaryGroup title="Ofis">
          <SummaryRow label="Ofis adı" value={name || "Zorunlu"} muted={!name} tab="ofis" field="office_name" />
          <SummaryRow label="Vitrin adresi" value={slug || "Girilmedi"} muted={!slug} tab="ofis" field="slug" />
          <SummaryRow
            label="Telefon"
            value={text(values.office_phone) ? formatPhoneDisplay(values.office_phone) : "Girilmedi"}
            muted={!text(values.office_phone)}
            tab="ofis"
            field="office_phone"
          />
          <SummaryRow label="İl" value={display.province_id ?? "Girilmedi"} muted={!display.province_id} tab="ofis" field="province_id" />
          <SummaryRow label="İlçe" value={display.district_id ?? "Girilmedi"} muted={!display.district_id} tab="ofis" field="district_id" />
          <SummaryRow label="Adres" value={text(values.address_line) || "Girilmedi"} muted={!text(values.address_line)} tab="ofis" field="address_line" />
          <SummaryRow label="Yetki belgesi" value={text(values.license_no) || "Girilmedi"} muted={!text(values.license_no)} tab="ofis" field="license_no" />
        </SummaryGroup>

        <SummaryGroup title="Ofis sahibi">
          <SummaryRow label="Ad soyad" value={ownerName || "Zorunlu"} muted={!ownerName} tab="sahip" field="owner_name" />
          <SummaryRow label="E-posta" value={ownerEmail || "Zorunlu"} muted={!ownerEmail} tab="sahip" field="owner_email" />
          <SummaryRow
            label="Telefon"
            value={text(values.owner_phone) ? formatPhoneDisplay(values.owner_phone) : "Girilmedi"}
            muted={!text(values.owner_phone)}
            tab="sahip"
            field="owner_phone"
          />
          <SummaryRow label="Erişim" value={OFFICE_ACCESS_MODE_LABELS[mode] ?? OFFICE_ACCESS_MODE_LABELS.link} tab="sahip" field="access_mode" />
        </SummaryGroup>

        <SummaryGroup title={`${plan.name} paketi`}>
          <SummaryRow
            label="Tutar"
            value={
              status !== "active"
                ? `${tl(plan.monthlyTry)}/ay · döngü ödemede seçilir`
                : cycle === "yearly"
                  ? `${tl(planAmountTry(plan.id, "yearly"))}/yıl`
                  : `${tl(plan.monthlyTry)}/ay`
            }
            tab="paket"
            field="billing_cycle"
          />
          <SummaryRow
            label="Deneme"
            value={status === "active" ? "Uygulanmaz (aktif başlar)" : `${trialDays} gün (sabit)`}
            tab="paket"
            field="initial_status"
          />
          {planLimitLines(plan).map(([k, v]) => (
            <SummaryRow key={k} label={k} value={v} tab="paket" field="plan" />
          ))}
        </SummaryGroup>

        <SummaryGroup title="Fatura ve başlangıç">
          <SummaryRow label="Vergi dairesi" value={text(values.tax_office) || "Girilmedi"} muted={!text(values.tax_office)} tab="fatura" field="tax_office" />
          <SummaryRow label="Vergi no" value={text(values.tax_number) || "Girilmedi"} muted={!text(values.tax_number)} tab="fatura" field="tax_number" />
          <SummaryRow label="Örnek veri" value={values.seed_sample ? "Yüklenecek" : "Yüklenmeyecek (boş ofis)"} tab="baslangic" field="seed_sample" />
        </SummaryGroup>
      </>
    );
  }

  return (
    <TabbedFormShell
      title="Yeni ofis"
      description="Ofisi, sahibini ve paketini tek seferde açın. Ofis ve abonelik kaydı tek işlemde oluşturulur; yarım kayıt kalmaz."
      eyebrow="Ofis envanteri"
      breadcrumbs={[{ label: "Ofisler", href: "/admin/tenants" }, { label: "Yeni ofis" }]}
      cancelHref="/admin/tenants"
      submitLabel="Ofisi aç"
      pendingLabel="Ofis açılıyor…"
      pending={pending}
      error={error}
      errorNextStep={null}
      onSubmit={onSubmit}
      tabs={tabs}
      tabPanels={tabPanels}
      summary={renderSummary}
      fieldLabels={FIELD_LABELS}
    />
  );
}

/** Sonuç ekranı (popup değil): ofis açıldı; geçici parola varsa yalnız burada, bir kez. */
function OfficeCreated({ result, onAnother }: { result: CreateOfficeResult; onAnother: () => void }) {
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);
  const password = result.tempPassword ?? "";
  const warnings = result.warnings ?? [];

  async function copyPassword() {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* pano erişimi yoksa kullanıcı parolayı gösterip elle kopyalar */
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <section role="status" className="rounded-[var(--radius-panel)] border border-line bg-surface p-6 shadow-[var(--shadow-sm)]">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[var(--radius-card)] bg-mint-500/12 text-mint-700">
            <CircleCheck className="h-6 w-6" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-accent">Ofis açıldı</p>
            <h1 className="font-display text-2xl font-bold tracking-tight text-text">{result.tenantName}</h1>
            <p className="mt-1 text-sm text-text-muted">Ofis, sahip hesabı ve abonelik kaydı tek işlemde oluşturuldu.</p>
          </div>
        </div>

        <dl className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className="rounded-[var(--radius-control)] border border-line bg-canvas/60 p-3">
            <dt className="text-xs font-semibold text-text-muted">Vitrin adresi</dt>
            <dd className="numeric mt-0.5 break-all font-mono text-sm font-semibold text-ink-950">/vitrin/{result.slug}</dd>
          </div>
          <div className="rounded-[var(--radius-control)] border border-line bg-canvas/60 p-3">
            <dt className="text-xs font-semibold text-text-muted">Sahip e-postası</dt>
            <dd className="mt-0.5 break-all text-sm font-semibold text-ink-950">{result.ownerEmail}</dd>
          </div>
          <div className="rounded-[var(--radius-control)] border border-line bg-canvas/60 p-3 sm:col-span-2">
            <dt className="text-xs font-semibold text-text-muted">Erişim e-postası</dt>
            <dd className={cn("mt-0.5 text-sm font-semibold", result.accessLinkSent ? "text-mint-700" : "text-danger-600")}>
              {result.accessLinkSent
                ? "Şifre belirleme bağlantısı sahibin e-postasına gönderildi."
                : "Gönderilemedi. Ofis 360 > Yönetim sekmesinden yeniden gönderin."}
            </dd>
          </div>
        </dl>

        {password ? (
          <div className="mt-4 rounded-[var(--radius-card)] border border-amber-400/40 bg-amber-400/10 p-4">
            <p className="text-sm font-bold text-amber-800">Geçici parola (yalnız bir kez gösterilir)</p>
            <div className="mt-2 flex items-stretch gap-2">
              <code className="numeric flex min-h-11 min-w-0 flex-1 items-center break-all rounded-[var(--radius-control)] border border-line bg-surface px-3 font-mono text-sm text-ink-950">
                {show ? password : "•".repeat(Math.min(password.length, 16))}
              </code>
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                aria-pressed={show}
                aria-label={show ? "Parolayı gizle" : "Parolayı göster"}
                className="focus-ring press inline-flex w-11 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-line bg-surface text-text-muted transition hover:bg-canvas"
              >
                {show ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
              </button>
              <button
                type="button"
                onClick={copyPassword}
                aria-label="Parolayı kopyala"
                className="focus-ring press inline-flex w-11 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-line bg-surface text-text-muted transition hover:bg-canvas"
              >
                {copied ? <Check className="h-4 w-4 text-mint-600" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
              </button>
            </div>
            <p className="mt-2 text-xs text-amber-800">
              Bu sayfadan ayrıldığınızda parola bir daha gösterilmez; kaydedilmedi ve denetim kaydına yazılmadı. Sahibe
              güvenli bir kanaldan iletin; ilk girişte değiştirmesini isteyin.
            </p>
          </div>
        ) : null}

        {warnings.length > 0 ? (
          <div role="alert" className="mt-4 rounded-[var(--radius-card)] border border-danger-500/25 bg-danger-500/8 p-4">
            <p className="flex items-center gap-2 text-sm font-bold text-danger-600">
              <TriangleAlert className="h-4 w-4" aria-hidden /> Tamamlanamayan adımlar ({warnings.length})
            </p>
            <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm text-danger-600">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="mt-6 flex flex-wrap gap-2">
          <Link
            href={`/admin/tenants/${result.tenantId}`}
            className="focus-ring press inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] bg-brand-600 px-4 text-sm font-semibold text-white transition hover:bg-brand-700"
          >
            Ofis 360&apos;a git <ArrowUpRight className="h-4 w-4" aria-hidden />
          </Link>
          <Link
            href={`/admin/tenants/${result.tenantId}?sekme=yonetim`}
            className="focus-ring press inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] border border-line bg-surface px-4 text-sm font-semibold text-ink-950 transition hover:bg-canvas"
          >
            Yönetim sekmesi
          </Link>
          <button
            type="button"
            onClick={onAnother}
            className="focus-ring press inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] border border-line bg-surface px-4 text-sm font-semibold text-ink-950 transition hover:bg-canvas"
          >
            <Plus className="h-4 w-4" aria-hidden /> Bir ofis daha ekle
          </button>
          <Link
            href="/admin/tenants"
            className="focus-ring press inline-flex min-h-11 items-center rounded-[var(--radius-control)] px-3 text-sm font-semibold text-text-muted transition hover:text-ink-950"
          >
            Ofis listesi
          </Link>
        </div>
      </section>
    </div>
  );
}
