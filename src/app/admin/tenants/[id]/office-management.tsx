"use client";

import { useEffect, useState, useTransition } from "react";
import type { FormEvent, ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Archive,
  Ban,
  Building2,
  CalendarClock,
  Check,
  Copy,
  CreditCard,
  Download,
  ExternalLink,
  Globe,
  KeyRound,
  Loader2,
  Mail,
  Pencil,
  Power,
  Send,
  ShieldAlert,
  StickyNote,
  Undo2,
  UserCog,
  UserMinus,
  UserPlus,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { updateTenantPlanStatus } from "@/app/actions/platform";
import { processOfficeClosureRequestByAdmin } from "@/app/actions/platform-tenant-closure";
import {
  addTenantPlatformNote,
  addTenantUserByAdmin,
  changeTenantOwnerEmailByAdmin,
  changeTenantSlugByAdmin,
  checkOfficeSlugAvailability,
  extendTenantTrialByAdmin,
  resendTenantOwnerAccessLink,
  setTenantLifecycleByAdmin,
  setTenantUserActiveByAdmin,
  transferTenantOwnershipByAdmin,
  updateTenantProfileByAdmin,
  type OfficeActionResult,
  type OfficeUserResult,
  type SlugCheckResult,
} from "@/app/actions/platform-tenants";
import { GeoSelect } from "@/components/app/geo-select";
import { EmailInput } from "@/components/ui/email-input";
import { FormField, FormInput, FormSelect, FormTextarea, fieldClass } from "@/components/ui/form-controls";
import { InlineTabbedPanel, type InlineTab } from "@/components/ui/inline-tabbed-panel";
import { PhoneInput } from "@/components/ui/phone-input";
import {
  OFFICE_ACCESS_MODE_LABELS,
  OFFICE_ROLE_LABELS,
  OFFICE_STATUS_LABELS,
  OFFICE_USER_ROLES,
} from "@/lib/admin/office-create-rules";
import { roleLabel } from "@/lib/role-labels";
import type { ClosureRequestRow, ManagementMember, ManagementNote, OfficeAdminCanMap } from "@/lib/admin/office-management";
import { OFFICE_SLUG_MAX, sanitizeSlugTyping, validateOfficeSlug } from "@/lib/admin/office-slug";
import { TAB_ICONS as TI } from "@/lib/icons";
import { formatPhoneDisplay } from "@/lib/phone";
import { cn } from "@/lib/utils";

/**
 * Ofis 360 > Yönetim sekmesi. Tüm işlemler SAYFA İÇİNDE açılır (popup yok): düzenleme için
 * `InlineTabbedPanel`, kısa işlemler için bölümün içinde açılan satır içi onay alanı.
 * Yetki: her bölüm yalnız rolün yapabildiği eylemleri çizer (`can`); sunucu action'ları aynı matrisi yeniden denetler.
 */

export type ManagedTenant = {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: string;
  /** Sunucuda biçimlenmiş deneme bitişi (yoksa null). */
  trialEndsLabel: string | null;
  phone: string | null;
  city: string | null;
  provinceId: string | null;
  districtId: string | null;
  addressLine: string | null;
  licenseNo: string | null;
  taxOffice: string | null;
  taxNumber: string | null;
};

type PlanOption = { id: string; name: string; monthlyTry: number; seats: number };

export type OfficeManagementProps = {
  tenant: ManagedTenant;
  can: OfficeAdminCanMap;
  owner: { id: string; fullName: string | null; email: string | null; isActive: boolean } | null;
  ownerCount: number;
  members: ManagementMember[];
  activeSeats: number;
  seatLimit: number;
  notes: (ManagementNote & { createdLabel: string })[];
  provinces: { id: string; name: string }[];
  plans: PlanOption[];
  /** Deneme uzatma tarih alanının en küçük değeri (yarın, TR; YYYY-AA-GG). */
  minTrialDate: string;
  legalHref: string;
  closureRequests: { id: string; type: "account_closure" | "data_export"; status: string; dueLabel: string; note: string | null; requestedBy: ClosureRequestRow["requestedBy"] }[];
};

type ActionState = { error?: string; message?: string } | null;

const btn =
  "focus-ring press inline-flex min-h-9 touch:min-h-11 items-center gap-1.5 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-xs font-semibold text-ink-950 transition hover:bg-canvas disabled:opacity-50";
const btnPrimary =
  "focus-ring press inline-flex min-h-9 touch:min-h-11 items-center gap-1.5 rounded-[var(--radius-control)] bg-brand-600 px-3 text-xs font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50";
const btnDanger =
  "focus-ring press inline-flex min-h-9 touch:min-h-11 items-center gap-1.5 rounded-[var(--radius-control)] bg-danger-500 px-3 text-xs font-semibold text-white transition hover:bg-danger-600 disabled:opacity-50";

/** Sunucu action'ını çalıştırır; başarıda sayfa verisini yeniler. Hata/başarı metni bölümde gösterilir. */
function useOfficeAction<R extends OfficeActionResult>(
  action: (formData: FormData) => Promise<R>,
  onOk?: (result: R) => void,
) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<ActionState>(null);

  function run(formData: FormData) {
    setState(null);
    startTransition(async () => {
      try {
        const result = await action(formData);
        if (result.error) {
          setState({ error: result.error });
          return;
        }
        setState({ message: result.message ?? "Kaydedildi." });
        onOk?.(result);
        router.refresh();
      } catch {
        setState({ error: "İşlem sırasında bağlantı kesildi. Lütfen tekrar deneyin." });
      }
    });
  }

  return { pending, state, run, clear: () => setState(null) };
}

function formDataOf(e: FormEvent<HTMLFormElement>, tenantId: string, extra?: Record<string, string>): FormData {
  e.preventDefault();
  const fd = new FormData(e.currentTarget);
  fd.set("id", tenantId);
  for (const [k, v] of Object.entries(extra ?? {})) fd.set(k, v);
  return fd;
}

function Feedback({ state }: { state: ActionState }) {
  if (!state) return null;
  return state.error ? (
    <p role="alert" className="rounded-[var(--radius-control)] bg-danger-500/8 px-3 py-2 text-xs font-semibold text-danger-600">
      {state.error}
    </p>
  ) : (
    <p role="status" className="rounded-[var(--radius-control)] bg-mint-500/10 px-3 py-2 text-xs font-semibold text-mint-700">
      {state.message}
    </p>
  );
}

function Section({
  id,
  title,
  description,
  icon: Icon,
  tone = "default",
  children,
  className,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  icon: LucideIcon;
  tone?: "default" | "danger";
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={cn(
        "dashboard-panel scroll-mt-24 rounded-[var(--radius-panel)] border bg-surface",
        tone === "danger" ? "border-danger-500/25" : "border-line",
        className,
      )}
    >
      <div className="flex items-start gap-3 border-b border-line px-5 py-3.5">
        <span
          aria-hidden="true"
          className={cn(
            "grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-control)]",
            tone === "danger" ? "bg-danger-500/10 text-danger-600" : "bg-brand-600/10 text-brand-700",
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h2 id={`${id}-title`} className="font-display text-base font-bold text-ink-950">{title}</h2>
          {description ? <p className="mt-0.5 text-xs text-text-muted">{description}</p> : null}
        </div>
      </div>
      <div className="space-y-3 p-5">{children}</div>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-bold uppercase tracking-wide text-text-faint">{label}</dt>
      <dd className="mt-0.5 break-words text-sm font-semibold text-ink-950">{value}</dd>
    </div>
  );
}

/** Satır içi onay/form alanı (modal değil): bölümün içinde açılır, sayfa kullanılmaya devam eder. */
function InlineArea({
  title,
  tone = "default",
  children,
}: {
  title: string;
  tone?: "default" | "danger" | "warn";
  children: ReactNode;
}) {
  return (
    <div
      role="group"
      aria-label={title}
      className={cn(
        "space-y-3 rounded-[var(--radius-card)] border p-4",
        tone === "danger" ? "border-danger-500/30 bg-danger-500/5" : tone === "warn" ? "border-amber-400/40 bg-amber-400/8" : "border-brand-300/50 bg-brand-600/[0.04]",
      )}
    >
      <p className="text-sm font-bold text-ink-950">{title}</p>
      {children}
    </div>
  );
}

function ConfirmName({ name, inputId }: { name: string; inputId: string }) {
  return (
    <FormField
      label={<>Onay için ofis adını yazın: <span className="font-bold">{name}</span></>}
      htmlFor={inputId}
      required
    >
      <FormInput id={inputId} name="confirm_name" required autoComplete="off" spellCheck={false} placeholder={name} />
    </FormField>
  );
}

export function OfficeManagement(props: OfficeManagementProps) {
  const { tenant, can } = props;
  const showUsers = can.add_user || can.deactivate_user || can.reactivate_user;
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {can.edit_profile || can.edit_billing_profile ? <ProfileSection {...props} /> : null}
      {can.plan_status || can.extend_trial ? <PlanSection {...props} /> : null}
      {can.change_slug ? <SlugSection tenant={tenant} /> : null}
      <OwnerSection {...props} />
      {showUsers ? <UsersSection {...props} /> : null}
      {can.note ? <NotesSection tenantId={tenant.id} notes={props.notes} /> : null}
      <LifecycleSection {...props} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ofis bilgileri + fatura profili
// ---------------------------------------------------------------------------

function ProfileSection({ tenant, can, provinces }: OfficeManagementProps) {
  const [open, setOpen] = useState(false);
  const act = useOfficeAction(updateTenantProfileByAdmin, () => setOpen(false));

  const tabs: InlineTab[] = [
    ...(can.edit_profile
      ? [{ id: "ofis", label: "Ofis bilgileri", icon: TI.temel, fields: ["name", "phone", "province_id", "district_id", "address_line", "license_no"] }]
      : []),
    ...(can.edit_billing_profile ? [{ id: "fatura", label: "Fatura profili", icon: TI.fatura, fields: ["tax_office", "tax_number"] }] : []),
  ];

  return (
    <Section
      id="yonetim-bilgi"
      title="Ofis bilgileri"
      description="Ad, iletişim, adres, yetki belgesi ve fatura profili."
      icon={Building2}
      className="xl:col-span-2"
    >
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="Ofis adı" value={tenant.name} />
        <Fact label="Telefon" value={tenant.phone ? formatPhoneDisplay(tenant.phone) : "—"} />
        <Fact label="Şehir" value={tenant.city || "—"} />
        <Fact label="Yetki belgesi no" value={tenant.licenseNo || "—"} />
        <div className="sm:col-span-2">
          <Fact label="Adres" value={tenant.addressLine || "—"} />
        </div>
        {can.edit_billing_profile ? (
          <>
            <Fact label="Vergi dairesi" value={tenant.taxOffice || "—"} />
            <Fact label="Vergi no" value={tenant.taxNumber || "—"} />
          </>
        ) : null}
      </dl>
      <Feedback state={open ? null : act.state} />
      <InlineTabbedPanel
        open={open}
        onOpenChange={(next) => {
          act.clear();
          setOpen(next);
        }}
        title="Ofis bilgilerini düzenle"
        description={tenant.name}
        icon={<Pencil />}
        tabs={tabs}
        hiddenFields={<input type="hidden" name="id" value={tenant.id} />}
        fieldLabels={{
          name: "Ofis adı",
          phone: "Telefon",
          province_id: "İl",
          district_id: "İlçe",
          address_line: "Adres",
          license_no: "Yetki belgesi no",
          tax_office: "Vergi dairesi",
          tax_number: "Vergi no",
        }}
        onSubmit={(fd) => act.run(fd)}
        pending={act.pending}
        error={act.state?.error ?? null}
        trigger={({ onClick, "aria-expanded": expanded, "aria-controls": controls }) => (
          <button type="button" onClick={onClick} aria-expanded={expanded} aria-controls={controls} className={btn}>
            <Pencil className="h-3.5 w-3.5" aria-hidden /> Bilgileri düzenle
          </button>
        )}
        panels={{
          ofis: (
            <>
              <FormField label="Ofis adı" htmlFor="mgmt-name" required className="sm:col-span-2">
                <FormInput id="mgmt-name" name="name" required minLength={2} maxLength={160} defaultValue={tenant.name} autoComplete="off" />
              </FormField>
              <FormField label="Telefon" htmlFor="mgmt-phone">
                <PhoneInput id="mgmt-phone" name="phone" defaultValue={tenant.phone} className={fieldClass} />
              </FormField>
              <FormField label="Yetki belgesi no" htmlFor="mgmt-license">
                <FormInput id="mgmt-license" name="license_no" maxLength={40} defaultValue={tenant.licenseNo ?? ""} autoComplete="off" />
              </FormField>
              <div className="sm:col-span-2">
                <GeoSelect
                  provinces={provinces}
                  defaultProvinceId={tenant.provinceId}
                  defaultDistrictId={tenant.districtId}
                  withNeighborhood={false}
                />
                {!tenant.provinceId && tenant.city ? (
                  <p className="mt-1.5 text-xs text-text-faint">
                    Ofisin kendi yazdığı şehir: <span className="font-semibold text-text-muted">{tenant.city}</span>. İl seçmezseniz bu metin korunur.
                  </p>
                ) : null}
              </div>
              <FormField label="Adres" htmlFor="mgmt-address" className="sm:col-span-2">
                <FormTextarea id="mgmt-address" name="address_line" rows={2} maxLength={300} defaultValue={tenant.addressLine ?? ""} />
              </FormField>
            </>
          ),
          fatura: (
            <>
              <FormField label="Vergi dairesi" htmlFor="mgmt-tax-office">
                <FormInput id="mgmt-tax-office" name="tax_office" maxLength={80} defaultValue={tenant.taxOffice ?? ""} autoComplete="off" />
              </FormField>
              <FormField label="Vergi no" htmlFor="mgmt-tax-number" hint="10 haneli VKN ya da 11 haneli TCKN.">
                <FormInput
                  id="mgmt-tax-number"
                  name="tax_number"
                  inputMode="numeric"
                  maxLength={11}
                  pattern="[0-9]{10,11}"
                  defaultValue={tenant.taxNumber ?? ""}
                  autoComplete="off"
                  className="numeric"
                />
              </FormField>
              <p className="text-xs text-text-muted sm:col-span-2">Fatura unvanı ofis adıdır; fatura adresi ofis adresidir.</p>
            </>
          ),
        }}
      />
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Paket, durum ve deneme süresi
// ---------------------------------------------------------------------------

const SAFE_STATUSES = ["trial", "active", "past_due"] as const;

function PlanSection({ tenant, can, plans, minTrialDate }: OfficeManagementProps) {
  const [mode, setMode] = useState<"none" | "plan" | "trial">("none");
  const planAct = useOfficeAction(
    async (fd: FormData): Promise<OfficeActionResult> => {
      const res = await updateTenantPlanStatus(fd);
      return res.ok ? { ok: true, message: "Paket ve durum güncellendi." } : { error: res.error ?? "Paket güncellenemedi." };
    },
    () => setMode("none"),
  );
  const trialAct = useOfficeAction(extendTenantTrialByAdmin, () => setMode("none"));
  const [plan, setPlan] = useState(tenant.plan);
  const selected = plans.find((p) => p.id === plan);
  const trialEligible = tenant.status === "trial" || tenant.status === "past_due";
  const locked = tenant.status === "suspended" || tenant.status === "cancelled";

  return (
    <Section
      id="yonetim-paket"
      title="Paket, durum ve deneme"
      description="Paket değişikliği anında ofisin paneline yansır; her değişiklik denetim kaydına yazılır."
      icon={CreditCard}
    >
      <dl className="grid gap-4 sm:grid-cols-3">
        <Fact label="Paket" value={plans.find((p) => p.id === tenant.plan)?.name ?? tenant.plan} />
        <Fact label="Durum" value={OFFICE_STATUS_LABELS[tenant.status] ?? tenant.status} />
        <Fact label="Deneme bitişi" value={tenant.trialEndsLabel ?? "—"} />
      </dl>

      <div className="flex flex-wrap gap-2">
        {can.plan_status ? (
          <button
            type="button"
            className={btn}
            aria-expanded={mode === "plan"}
            onClick={() => {
              planAct.clear();
              setMode(mode === "plan" ? "none" : "plan");
            }}
          >
            <CreditCard className="h-3.5 w-3.5" aria-hidden /> Paketi / durumu değiştir
          </button>
        ) : null}
        {can.extend_trial ? (
          <button
            type="button"
            className={btn}
            aria-expanded={mode === "trial"}
            disabled={!trialEligible}
            title={trialEligible ? undefined : "Deneme yalnız denemedeki ya da süresi dolmuş ofiste uzatılır"}
            onClick={() => {
              trialAct.clear();
              setMode(mode === "trial" ? "none" : "trial");
            }}
          >
            <CalendarClock className="h-3.5 w-3.5" aria-hidden /> Deneme süresini uzat
          </button>
        ) : null}
      </div>

      {mode === "plan" ? (
        <InlineArea title="Paket ve durum">
          <form onSubmit={(e) => planAct.run(formDataOf(e, tenant.id))} className="grid gap-3 sm:grid-cols-2">
            <FormField label="Paket" htmlFor="mgmt-plan">
              <FormSelect id="mgmt-plan" name="plan" value={plan} onChange={(e) => setPlan(e.target.value)}>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {new Intl.NumberFormat("tr-TR").format(p.monthlyTry)} ₺/ay
                  </option>
                ))}
              </FormSelect>
            </FormField>
            <FormField
              label="Durum"
              htmlFor="mgmt-status"
              hint={locked ? "Askıdaki/arşivdeki ofisin durumu «Erişim ve arşiv» bölümünden değiştirilir." : "Askıya alma ve arşivleme ayrı bölümdedir."}
            >
              <FormSelect id="mgmt-status" name="status" defaultValue={locked ? "" : tenant.status} disabled={locked}>
                {locked ? <option value="">{OFFICE_STATUS_LABELS[tenant.status] ?? tenant.status}</option> : null}
                {SAFE_STATUSES.map((s) => (
                  <option key={s} value={s}>{OFFICE_STATUS_LABELS[s]}</option>
                ))}
              </FormSelect>
            </FormField>
            {selected ? (
              <p className="text-xs text-text-muted sm:col-span-2">
                {selected.name}: en çok <span className="numeric font-semibold text-ink-950">{selected.seats}</span> aktif kullanıcı. Daha düşük
                pakete geçişte kullanım limiti aşıyorsa işlem reddedilir.
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <button type="submit" className={btnPrimary} disabled={planAct.pending}>
                {planAct.pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Check className="h-3.5 w-3.5" aria-hidden />} Kaydet
              </button>
              <button type="button" className={btn} onClick={() => setMode("none")}>Vazgeç</button>
            </div>
          </form>
        </InlineArea>
      ) : null}

      {mode === "trial" ? (
        <InlineArea title="Deneme süresini uzat" tone={tenant.status === "past_due" ? "warn" : "default"}>
          <form onSubmit={(e) => trialAct.run(formDataOf(e, tenant.id))} className="grid gap-3 sm:grid-cols-2">
            <FormField label="Yeni deneme bitişi" htmlFor="mgmt-trial" required hint="Seçilen günün sonuna kadar geçerlidir.">
              <FormInput id="mgmt-trial" name="trial_ends_on" type="date" required min={minTrialDate} />
            </FormField>
            {tenant.status === "past_due" ? (
              <p className="self-end text-xs font-semibold text-amber-700">
                Ofisin süresi dolmuş. Onaylarsanız ofis yeniden «Deneme» durumuna alınır ve süre uzatılır.
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <button type="submit" className={btnPrimary} disabled={trialAct.pending}>
                {trialAct.pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Check className="h-3.5 w-3.5" aria-hidden />} Süreyi uzat
              </button>
              <button type="button" className={btn} onClick={() => setMode("none")}>Vazgeç</button>
            </div>
          </form>
        </InlineArea>
      ) : null}

      <Feedback state={mode === "trial" ? trialAct.state : mode === "plan" ? planAct.state : (trialAct.state ?? planAct.state)} />
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Vitrin adresi (yalnız süper admin)
// ---------------------------------------------------------------------------

function SlugSection({ tenant }: { tenant: ManagedTenant }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(tenant.slug);
  const [checked, setChecked] = useState<{ slug: string; res: SlugCheckResult } | null>(null);
  const act = useOfficeAction(changeTenantSlugByAdmin, () => setOpen(false));
  const check = validateOfficeSlug(value);
  const valid = check.ok;
  const changed = value !== tenant.slug;

  useEffect(() => {
    if (!open || !valid || !changed) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const fd = new FormData();
      fd.set("slug", value);
      fd.set("exclude", tenant.id);
      fd.set("city", tenant.city ?? "");
      try {
        const res = await checkOfficeSlugAvailability(fd);
        if (!cancelled) setChecked({ slug: value, res });
      } catch {
        if (!cancelled) setChecked({ slug: value, res: { ok: false, error: "Adres şu an denetlenemedi." } });
      }
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, valid, changed, value, tenant.id, tenant.city]);

  const current = checked && checked.slug === value ? checked.res : null;
  const taken = Boolean(current?.ok && current.available === false);

  return (
    <Section
      id="yonetim-vitrin"
      title="Vitrin adresi"
      description="Ofisin herkese açık vitrin bağlantısı. Değişiklik yalnız süper admin tarafından yapılır."
      icon={Globe}
    >
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <span className="numeric break-all font-mono font-semibold text-ink-950">/vitrin/{tenant.slug}</span>
        <a
          href={`/vitrin/${tenant.slug}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline"
        >
          Vitrini aç <ExternalLink className="h-3 w-3" aria-hidden />
        </a>
      </p>
      <div>
        <button
          type="button"
          className={btn}
          aria-expanded={open}
          onClick={() => {
            act.clear();
            setValue(tenant.slug);
            setOpen(!open);
          }}
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden /> Adresi değiştir
        </button>
      </div>

      {open ? (
        <InlineArea title="Vitrin adresini değiştir" tone="danger">
          <p className="flex items-start gap-2 text-xs font-semibold text-danger-600">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            Eski bağlantılar (paylaşılmış vitrin linkleri, QR kodlar, arama motoru kayıtları) ÇALIŞMAZ. Eski adresten
            yeni adrese otomatik yönlendirme yoktur.
          </p>
          <form onSubmit={(e) => act.run(formDataOf(e, tenant.id))} className="space-y-3">
            <FormField label="Yeni vitrin adresi" htmlFor="mgmt-slug" required inject={false}>
              <FormInput
                id="mgmt-slug"
                name="slug"
                required
                value={value}
                onChange={(e) => setValue(sanitizeSlugTyping(e.target.value))}
                maxLength={OFFICE_SLUG_MAX}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                aria-describedby="mgmt-slug-status"
                className="numeric font-mono"
              />
              <p id="mgmt-slug-status" role="status" aria-live="polite" className="mt-1 min-h-5 text-xs font-semibold">
                {!changed ? (
                  <span className="text-text-muted">Mevcut adres. Değiştirmek için yeni bir adres yazın.</span>
                ) : !check.ok ? (
                  <span className="text-danger-600">{check.error}</span>
                ) : !current ? (
                  <span className="inline-flex items-center gap-1.5 text-text-muted">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Adres denetleniyor…
                  </span>
                ) : !current.ok ? (
                  <span className="text-amber-700">{current.error} Kayıtta yeniden denetlenecek.</span>
                ) : current.available ? (
                  <span className="text-mint-700">Bu adres kullanılabilir.</span>
                ) : (
                  <span className="text-danger-600">
                    Bu adres başka bir ofiste kullanılıyor.
                    {current.suggestions?.length ? ` Öneri: ${current.suggestions.join(", ")}` : ""}
                  </span>
                )}
              </p>
            </FormField>
            <label className="flex cursor-pointer items-start gap-2 text-xs font-semibold text-ink-950">
              <input type="checkbox" name="ack" value="1" required className="mt-0.5 h-4 w-4 accent-[var(--brand-600)]" />
              Eski vitrin bağlantılarının çalışmayacağını ve yönlendirme olmadığını anladım.
            </label>
            <div className="flex flex-wrap gap-2">
              <button type="submit" className={btnDanger} disabled={act.pending || !changed || !valid || taken}>
                {act.pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null} Adresi değiştir
              </button>
              <button type="button" className={btn} onClick={() => setOpen(false)}>Vazgeç</button>
            </div>
          </form>
        </InlineArea>
      ) : null}
      <Feedback state={act.state} />
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Ofis sahibi
// ---------------------------------------------------------------------------

function OwnerSection({ tenant, can, owner, ownerCount, members }: OfficeManagementProps) {
  const [mode, setMode] = useState<"none" | "resend" | "email" | "transfer">("none");
  const close = () => setMode("none");
  const resendAct = useOfficeAction(resendTenantOwnerAccessLink, close);
  const emailAct = useOfficeAction(changeTenantOwnerEmailByAdmin, close);
  const transferAct = useOfficeAction(transferTenantOwnershipByAdmin, close);
  const candidates = members.filter((m) => m.isActive && m.role !== "owner");
  const anyAction = can.resend_access || can.change_owner_email || can.transfer_ownership;
  const toggle = (next: typeof mode) => {
    resendAct.clear();
    emailAct.clear();
    transferAct.clear();
    setMode(mode === next ? "none" : next);
  };

  return (
    <Section
      id="yonetim-sahip"
      title="Ofis sahibi"
      description="Ofisin sahip rolündeki kullanıcısı. Sahip e-postası hesabın giriş anahtarıdır."
      icon={KeyRound}
    >
      {owner ? (
        <dl className="grid gap-4 sm:grid-cols-2">
          <Fact label="Ad soyad" value={owner.fullName || "İsimsiz kullanıcı"} />
          <Fact label="Giriş e-postası" value={owner.email || "—"} />
          <Fact label="Durum" value={owner.isActive ? "Aktif" : "Pasif"} />
          {ownerCount > 1 ? <Fact label="Uyarı" value={`${ownerCount} sahip kaydı var; sahipliği tek kullanıcıya devredin.`} /> : null}
        </dl>
      ) : (
        <p className="text-sm font-semibold text-danger-600">Bu ofisin sahip rolünde kullanıcısı yok. Sahipliği bir kullanıcıya devredin.</p>
      )}

      {anyAction ? (
        <div className="flex flex-wrap gap-2">
          {can.resend_access ? (
            <button type="button" className={btn} aria-expanded={mode === "resend"} disabled={!owner?.isActive} onClick={() => toggle("resend")}>
              <Send className="h-3.5 w-3.5" aria-hidden /> Erişim bağlantısını yeniden gönder
            </button>
          ) : null}
          {can.change_owner_email ? (
            <button type="button" className={btn} aria-expanded={mode === "email"} disabled={!owner || ownerCount > 1} onClick={() => toggle("email")}>
              <Mail className="h-3.5 w-3.5" aria-hidden /> E-postayı değiştir
            </button>
          ) : null}
          {can.transfer_ownership ? (
            <button type="button" className={btn} aria-expanded={mode === "transfer"} disabled={candidates.length === 0 && ownerCount <= 1} onClick={() => toggle("transfer")}>
              <UserCog className="h-3.5 w-3.5" aria-hidden /> Sahipliği devret
            </button>
          ) : null}
        </div>
      ) : null}

      {mode === "resend" ? (
        <InlineArea title="Erişim bağlantısı gönderilsin mi?">
          <p className="text-xs text-text-muted">
            <span className="font-semibold text-ink-950">{owner?.email}</span> adresine tek kullanımlık şifre belirleme bağlantısı gönderilir.
            Mevcut şifre bağlantı kullanılana kadar geçerli kalır.
          </p>
          <form onSubmit={(e) => resendAct.run(formDataOf(e, tenant.id))} className="flex flex-wrap gap-2">
            <button type="submit" className={btnPrimary} disabled={resendAct.pending}>
              {resendAct.pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Send className="h-3.5 w-3.5" aria-hidden />} Gönder
            </button>
            <button type="button" className={btn} onClick={close}>Vazgeç</button>
          </form>
        </InlineArea>
      ) : null}

      {mode === "email" ? (
        <InlineArea title="Sahip e-postasını değiştir" tone="danger">
          <form onSubmit={(e) => emailAct.run(formDataOf(e, tenant.id))} className="grid gap-3 sm:grid-cols-2">
            <FormField label="Yeni e-posta" htmlFor="mgmt-owner-email" required className="sm:col-span-2" hint="Yeni adrese şifre belirleme bağlantısı gönderilir.">
              <EmailInput id="mgmt-owner-email" name="new_email" required autoComplete="off" />
            </FormField>
            <label className="flex cursor-pointer items-start gap-2 text-xs font-semibold text-ink-950 sm:col-span-2">
              <input type="checkbox" name="reset_password" value="1" defaultChecked className="mt-0.5 h-4 w-4 accent-[var(--brand-600)]" />
              Mevcut parolayı geçersiz kıl (hesap el değiştiriyorsa işaretli bırakın; yalnız yeni adresteki bağlantıyla giriş yapılır).
            </label>
            <div className="sm:col-span-2">
              <ConfirmName name={tenant.name} inputId="mgmt-owner-email-confirm" />
            </div>
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <button type="submit" className={btnDanger} disabled={emailAct.pending}>
                {emailAct.pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null} E-postayı değiştir
              </button>
              <button type="button" className={btn} onClick={close}>Vazgeç</button>
            </div>
          </form>
        </InlineArea>
      ) : null}

      {mode === "transfer" ? (
        <InlineArea title="Sahipliği devret" tone="danger">
          <p className="text-xs text-text-muted">
            Önce yeni sahip atanır, sonra mevcut sahip «Genel müdür» rolüne alınır (ofis hiçbir an sahipsiz kalmaz). Roller,
            kullanıcıların bir sonraki oturum yenilemesinde geçerli olur; gerekirse yeniden giriş yapmaları gerekir.
          </p>
          <form onSubmit={(e) => transferAct.run(formDataOf(e, tenant.id))} className="grid gap-3 sm:grid-cols-2">
            <FormField label="Yeni sahip" htmlFor="mgmt-new-owner" required className="sm:col-span-2">
              <FormSelect id="mgmt-new-owner" name="new_owner_id" required defaultValue="">
                <option value="" disabled>Aktif bir kullanıcı seçin</option>
                {members
                  .filter((m) => m.isActive && (m.role !== "owner" || ownerCount > 1))
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.fullName || "İsimsiz kullanıcı"} · {OFFICE_ROLE_LABELS[m.role] ?? m.role}
                    </option>
                  ))}
              </FormSelect>
            </FormField>
            <div className="sm:col-span-2">
              <ConfirmName name={tenant.name} inputId="mgmt-transfer-confirm" />
            </div>
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <button type="submit" className={btnDanger} disabled={transferAct.pending}>
                {transferAct.pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null} Sahipliği devret
              </button>
              <button type="button" className={btn} onClick={close}>Vazgeç</button>
            </div>
          </form>
        </InlineArea>
      ) : null}

      <Feedback state={resendAct.state ?? emailAct.state ?? transferAct.state} />
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Kullanıcılar (ofis adına ekle / pasifleştir)
// ---------------------------------------------------------------------------

function UsersSection({ tenant, can, members, activeSeats, seatLimit }: OfficeManagementProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [created, setCreated] = useState<{ password: string; linkSent: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const addAct = useOfficeAction<OfficeUserResult>(addTenantUserByAdmin, (res) => {
    setAddOpen(false);
    setCreated(res.tempPassword ? { password: res.tempPassword, linkSent: Boolean(res.accessLinkSent) } : null);
  });
  const activeAct = useOfficeAction(setTenantUserActiveByAdmin, () => setConfirmId(null));
  const full = activeSeats >= seatLimit;

  function setActive(memberId: string, active: boolean) {
    const fd = new FormData();
    fd.set("id", tenant.id);
    fd.set("member_id", memberId);
    fd.set("active", active ? "true" : "false");
    activeAct.run(fd);
  }

  async function copyPassword() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.password);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* pano erişimi yoksa parola ekrandan elle kopyalanır */
    }
  }

  return (
    <Section
      id="yonetim-kullanici"
      title="Kullanıcılar"
      description="Ofis adına kullanıcı ekleyin ya da erişimi kapatın. Yalnız ad, rol ve durum gösterilir."
      icon={Users}
      className="xl:col-span-2"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-text-muted">
          Aktif kullanıcı:{" "}
          <span className={cn("numeric font-bold", full ? "text-danger-600" : "text-ink-950")}>
            {activeSeats} / {seatLimit}
          </span>{" "}
          (paket limiti)
        </p>
        {can.add_user ? (
          <InlineTabbedPanel
            open={addOpen}
            onOpenChange={(next) => {
              addAct.clear();
              setAddOpen(next);
            }}
            title="Ofise kullanıcı ekle"
            description={tenant.name}
            icon={<UserPlus />}
            tabs={[{ id: "kullanici", label: "Kullanıcı", fields: ["full_name", "email", "phone", "role", "access_mode"] }]}
            hiddenFields={<input type="hidden" name="id" value={tenant.id} />}
            fieldLabels={{ full_name: "Ad soyad", email: "E-posta", phone: "Telefon", role: "Rol", access_mode: "Erişim yöntemi" }}
            submitLabel="Kullanıcıyı ekle"
            onSubmit={(fd) => addAct.run(fd)}
            pending={addAct.pending}
            error={addAct.state?.error ?? null}
            trigger={({ onClick, "aria-expanded": expanded, "aria-controls": controls }) => (
              <button
                type="button"
                onClick={onClick}
                aria-expanded={expanded}
                aria-controls={controls}
                className={btnPrimary}
                disabled={full}
                title={full ? "Paket kullanıcı limiti dolu; önce paketi yükseltin" : undefined}
              >
                <UserPlus className="h-3.5 w-3.5" aria-hidden /> Kullanıcı ekle
              </button>
            )}
            panels={{
              kullanici: (
                <>
                  <FormField label="Ad soyad" htmlFor="mgmt-user-name" required className="sm:col-span-2">
                    <FormInput id="mgmt-user-name" name="full_name" required minLength={2} maxLength={120} autoComplete="off" />
                  </FormField>
                  <FormField label="E-posta" htmlFor="mgmt-user-email" required>
                    <EmailInput id="mgmt-user-email" name="email" required autoComplete="off" />
                  </FormField>
                  <FormField label="Telefon" htmlFor="mgmt-user-phone" hint="Yalnız Türkiye cep numarası.">
                    <PhoneInput id="mgmt-user-phone" name="phone" className={fieldClass} />
                  </FormField>
                  <FormField label="Rol" htmlFor="mgmt-user-role" required>
                    <FormSelect id="mgmt-user-role" name="role" defaultValue="advisor" required>
                      {OFFICE_USER_ROLES.map((r) => (
                        <option key={r} value={r}>{OFFICE_ROLE_LABELS[r]}</option>
                      ))}
                    </FormSelect>
                  </FormField>
                  <FormField label="Erişim yöntemi" htmlFor="mgmt-user-access">
                    <FormSelect id="mgmt-user-access" name="access_mode" defaultValue="link">
                      <option value="link">{OFFICE_ACCESS_MODE_LABELS.link}</option>
                      <option value="link_temp">{OFFICE_ACCESS_MODE_LABELS.link_temp}</option>
                    </FormSelect>
                  </FormField>
                </>
              ),
            }}
          />
        ) : null}
      </div>

      {created ? (
        <div className="rounded-[var(--radius-card)] border border-amber-400/40 bg-amber-400/10 p-4">
          <p className="text-sm font-bold text-amber-800">Geçici parola (yalnız bir kez gösterilir)</p>
          <div className="mt-2 flex items-stretch gap-2">
            <code className="numeric flex min-h-11 min-w-0 flex-1 items-center break-all rounded-[var(--radius-control)] border border-line bg-surface px-3 font-mono text-sm text-ink-950">
              {created.password}
            </code>
            <button type="button" onClick={copyPassword} aria-label="Parolayı kopyala" className={cn(btn, "w-11 justify-center px-0")}>
              {copied ? <Check className="h-4 w-4 text-mint-600" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
            </button>
            <button type="button" onClick={() => setCreated(null)} className={btn}>Kapat</button>
          </div>
          <p className="mt-2 text-xs text-amber-800">
            Parola kaydedilmedi ve denetim kaydına yazılmadı. {created.linkSent ? "Şifre belirleme e-postası da gönderildi." : "Erişim e-postası gönderilemedi."}
          </p>
        </div>
      ) : null}

      {members.length === 0 ? (
        <p className="py-4 text-center text-sm text-text-muted">Bu ofiste kullanıcı yok.</p>
      ) : (
        <ul className="divide-y divide-line rounded-[var(--radius-card)] border border-line">
          {members.map((m) => {
            const isOwner = m.role === "owner";
            const canToggle = m.isActive ? can.deactivate_user && !isOwner : can.reactivate_user;
            return (
              <li key={m.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <Link href={`/admin/members/${m.id}`} className="truncate text-sm font-semibold text-ink-950 transition hover:text-brand-600">
                      {m.fullName || "İsimsiz kullanıcı"}
                    </Link>
                    <p className="text-xs text-text-faint">
                      {OFFICE_ROLE_LABELS[m.role] ?? m.role} · {m.isActive ? "Aktif" : "Pasif"}
                    </p>
                  </div>
                  {canToggle ? (
                    m.isActive ? (
                      <button
                        type="button"
                        className={btn}
                        aria-expanded={confirmId === m.id}
                        onClick={() => {
                          activeAct.clear();
                          setConfirmId(confirmId === m.id ? null : m.id);
                        }}
                      >
                        <UserMinus className="h-3.5 w-3.5" aria-hidden /> Pasife al
                      </button>
                    ) : (
                      <button type="button" className={btn} disabled={activeAct.pending || full} title={full ? "Paket kullanıcı limiti dolu" : undefined} onClick={() => setActive(m.id, true)}>
                        <Power className="h-3.5 w-3.5" aria-hidden /> Yeniden etkinleştir
                      </button>
                    )
                  ) : isOwner ? (
                    <span className="text-xs text-text-faint">Sahip pasife alınamaz</span>
                  ) : null}
                </div>
                {confirmId === m.id ? (
                  <div className="mt-3">
                    <InlineArea title={`${m.fullName || "Kullanıcı"} pasife alınsın mı?`} tone="danger">
                      <p className="text-xs text-text-muted">Kullanıcının girişi kapatılır ve açık oturumları sonlandırılır. Kayıtları silinmez; yeniden etkinleştirilebilir.</p>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" className={btnDanger} disabled={activeAct.pending} onClick={() => setActive(m.id, false)}>
                          {activeAct.pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null} Pasife al
                        </button>
                        <button type="button" className={btn} onClick={() => setConfirmId(null)}>Vazgeç</button>
                      </div>
                    </InlineArea>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <Feedback state={activeAct.state ?? (addOpen ? null : addAct.state)} />
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Dahili notlar
// ---------------------------------------------------------------------------

function NotesSection({ tenantId, notes }: { tenantId: string; notes: OfficeManagementProps["notes"] }) {
  const [text, setText] = useState("");
  const act = useOfficeAction(addTenantPlatformNote, () => setText(""));
  return (
    <Section
      id="yonetim-not"
      title="Dahili notlar"
      description="Yalnız platform personeli görür; ofis göremez. Notlar denetim kaydıdır: düzenlenemez ve silinemez."
      icon={StickyNote}
    >
      <form onSubmit={(e) => act.run(formDataOf(e, tenantId))} className="space-y-2">
        <FormField label="Yeni not" htmlFor="mgmt-note" hint="Müşteri kişisel verisi yazmayın. En çok 1000 karakter.">
          <FormTextarea id="mgmt-note" name="note" rows={3} maxLength={1000} required minLength={3} value={text} onChange={(e) => setText(e.target.value)} />
        </FormField>
        <button type="submit" className={btnPrimary} disabled={act.pending || text.trim().length < 3}>
          {act.pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <StickyNote className="h-3.5 w-3.5" aria-hidden />} Not ekle
        </button>
      </form>
      <Feedback state={act.state} />
      {notes.length === 0 ? (
        <p className="py-3 text-center text-sm text-text-muted">Bu ofis için henüz dahili not yok.</p>
      ) : (
        <ul className="space-y-2">
          {notes.map((n) => (
            <li key={n.id} className="rounded-[var(--radius-control)] border border-line bg-canvas/60 p-3">
              <p className="whitespace-pre-wrap break-words text-sm text-ink-950">{n.note}</p>
              <p className="mt-1 text-xs text-text-faint">
                {n.author ?? "Platform personeli"} · {n.createdLabel}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Erişim ve arşiv (askıya al / etkinleştir / arşivle / geri yükle) + veri paketi
// ---------------------------------------------------------------------------

function LifecycleSection({ tenant, can, legalHref, closureRequests }: OfficeManagementProps) {
  const [mode, setMode] = useState<"none" | "suspend" | "reactivate" | "archive" | "restore">("none");
  const act = useOfficeAction(setTenantLifecycleByAdmin, () => setMode("none"));
  const suspended = tenant.status === "suspended";
  const archived = tenant.status === "cancelled";
  const toggle = (next: typeof mode) => {
    act.clear();
    setMode(mode === next ? "none" : next);
  };
  const anyAction =
    (can.suspend && !suspended && !archived) || (can.reactivate && suspended) || (can.archive && !archived) || (can.restore && archived);

  return (
    <Section
      id="yonetim-erisim"
      title="Erişim ve arşiv"
      description="Askıya alma erişimi anında keser. Arşivleme ofisi kapatır ama veriyi silmez; geri yüklenebilir."
      icon={ShieldAlert}
      tone="danger"
      className="xl:col-span-2"
    >
      <p className="text-sm text-text-muted">
        Şu anki durum: <span className="font-bold text-ink-950">{OFFICE_STATUS_LABELS[tenant.status] ?? tenant.status}</span>
        {suspended || archived ? " · ofis kullanıcıları panele giremez." : ""}
      </p>

      {anyAction ? (
        <div className="flex flex-wrap gap-2">
          {can.suspend && !suspended && !archived ? (
            <button type="button" className={btn} aria-expanded={mode === "suspend"} onClick={() => toggle("suspend")}>
              <Ban className="h-3.5 w-3.5" aria-hidden /> Askıya al
            </button>
          ) : null}
          {can.reactivate && suspended ? (
            <button type="button" className={btn} aria-expanded={mode === "reactivate"} onClick={() => toggle("reactivate")}>
              <Power className="h-3.5 w-3.5" aria-hidden /> Yeniden etkinleştir
            </button>
          ) : null}
          {can.archive && !archived ? (
            <button type="button" className={btn} aria-expanded={mode === "archive"} onClick={() => toggle("archive")}>
              <Archive className="h-3.5 w-3.5" aria-hidden /> Arşivle
            </button>
          ) : null}
          {can.restore && archived ? (
            <button type="button" className={btn} aria-expanded={mode === "restore"} onClick={() => toggle("restore")}>
              <Undo2 className="h-3.5 w-3.5" aria-hidden /> Arşivden geri yükle
            </button>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-text-faint">Bu durumdaki ofis için rolünüzle yapılabilecek bir erişim işlemi yok.</p>
      )}

      {mode === "suspend" || mode === "archive" ? (
        <InlineArea title={mode === "suspend" ? "Ofis askıya alınsın mı?" : "Ofis arşivlensin mi?"} tone="danger">
          <p className="text-xs text-text-muted">
            {mode === "suspend"
              ? "Ofisin tüm kullanıcıları panele erişemez; vitrin yayından kalkar. Veriler korunur, «Yeniden etkinleştir» ile geri alınır."
              : "Ofis iptal durumuna alınır ve aboneliği kapatılır. Hiçbir veri silinmez; «Arşivden geri yükle» ile geri alınır. Kalıcı silme bu ekranda yoktur."}
          </p>
          <form onSubmit={(e) => act.run(formDataOf(e, tenant.id, { mode }))} className="grid gap-3">
            <FormField label="Gerekçe" htmlFor="mgmt-lifecycle-reason" required hint="Denetim kaydına yazılır.">
              <FormTextarea id="mgmt-lifecycle-reason" name="reason" rows={2} required minLength={5} maxLength={500} />
            </FormField>
            <ConfirmName name={tenant.name} inputId="mgmt-lifecycle-confirm" />
            <div className="flex flex-wrap gap-2">
              <button type="submit" className={btnDanger} disabled={act.pending}>
                {act.pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
                {mode === "suspend" ? "Askıya al" : "Arşivle"}
              </button>
              <button type="button" className={btn} onClick={() => setMode("none")}>Vazgeç</button>
            </div>
          </form>
        </InlineArea>
      ) : null}

      {mode === "reactivate" || mode === "restore" ? (
        <InlineArea title={mode === "reactivate" ? "Ofis yeniden etkinleştirilsin mi?" : "Ofis arşivden geri yüklensin mi?"}>
          <form onSubmit={(e) => act.run(formDataOf(e, tenant.id, { mode }))} className="grid gap-3 sm:grid-cols-2">
            <FormField label="Dönülecek durum" htmlFor="mgmt-target-status" hint="Deneme seçilirse mevcut deneme bitişi geçerli olur; gerekiyorsa süreyi ayrıca uzatın.">
              <FormSelect id="mgmt-target-status" name="target_status" defaultValue="active">
                <option value="active">{OFFICE_STATUS_LABELS.active}</option>
                <option value="trial">{OFFICE_STATUS_LABELS.trial}</option>
              </FormSelect>
            </FormField>
            <div className="flex flex-wrap items-end gap-2">
              <button type="submit" className={btnPrimary} disabled={act.pending}>
                {act.pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Check className="h-3.5 w-3.5" aria-hidden />}
                {mode === "reactivate" ? "Etkinleştir" : "Geri yükle"}
              </button>
              <button type="button" className={btn} onClick={() => setMode("none")}>Vazgeç</button>
            </div>
          </form>
        </InlineArea>
      ) : null}

      <Feedback state={act.state} />

      {can.archive && closureRequests.length > 0 ? <ClosureRequests tenant={tenant} requests={closureRequests} /> : null}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-3 text-xs text-text-muted">
        {can.export_vault ? (
          <a href={`/api/admin/tenants/${tenant.id}/export`} className="inline-flex items-center gap-1.5 font-semibold text-brand-600 hover:underline">
            <Download className="h-3.5 w-3.5" aria-hidden /> Veri paketini indir (ayrılış kasası)
          </a>
        ) : null}
        <Link href={legalHref} className="inline-flex items-center gap-1.5 font-semibold text-brand-600 hover:underline">
          KVKK silme ve onay kayıtları
        </Link>
        <span>Kalıcı silme yalnız KVKK süreciyle, ayrı bir talep olarak yürütülür.</span>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Ofis sahibinin kapatma / veri indirme talepleri (satır içi onay; veri silinmez)
// ---------------------------------------------------------------------------

function ClosureRequests({ tenant, requests }: { tenant: ManagedTenant; requests: OfficeManagementProps["closureRequests"] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const act = useOfficeAction(processOfficeClosureRequestByAdmin, () => setOpenId(null));
  return (
    <InlineArea title={`Ofis sahibinin talepleri (${requests.length})`}>
      <p className="text-xs text-text-muted">
        Hesap kapatma talebi işlenince ofis arşivlenir (veri silinmez, geri yüklenebilir) ve talep tamamlanır. Ofis sahibi
        arşiv sonrası Askıda sayfasından kendi veri paketini indirebilir.
      </p>
      <ul className="divide-y divide-line">
        {requests.map((r) => (
          <li key={r.id} className="space-y-2 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-semibold text-ink-950">
                {r.type === "account_closure" ? "Ofis hesabını kapatma" : "Ofis verisini indirme"}
                <span className="ml-2 text-xs font-normal text-text-muted">son tarih {r.dueLabel}</span>
              </span>
              <button type="button" className={btn} aria-expanded={openId === r.id} onClick={() => { act.clear(); setOpenId(openId === r.id ? null : r.id); }}>
                Talebi işle
              </button>
            </div>
            <p className="text-xs text-text-muted">
              Talebi açan:{" "}
              {r.requestedBy
                ? `${r.requestedBy.fullName ?? "Adsız kullanıcı"} (${roleLabel(r.requestedBy.role)}${r.requestedBy.isActive ? "" : ", pasif"})`
                : "bilinmiyor"}
              {!r.requestedBy || !r.requestedBy.isActive || (r.requestedBy.role !== "owner" && r.requestedBy.role !== "gm")
                ? " — bu kullanıcı artık aktif sahip/genel müdür değil; talep işlenemez."
                : ""}
            </p>
            {r.note ? <p className="text-xs text-text-muted">Not: {r.note}</p> : null}
            {openId === r.id ? (
              <form onSubmit={(e) => act.run(formDataOf(e, tenant.id, { request_id: r.id }))} className="grid gap-3">
                <FormField label="Gerekçe" htmlFor={`mgmt-closure-reason-${r.id}`} required hint="Denetim kaydına ve talep çözüm notuna yazılır.">
                  <FormTextarea id={`mgmt-closure-reason-${r.id}`} name="reason" rows={2} required minLength={5} maxLength={500} />
                </FormField>
                <ConfirmName name={tenant.name} inputId={`mgmt-closure-confirm-${r.id}`} />
                <div className="flex flex-wrap gap-2">
                  <button type="submit" className={r.type === "account_closure" ? btnDanger : btnPrimary} disabled={act.pending}>
                    {act.pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
                    {r.type === "account_closure" ? "Ofisi arşivle ve talebi tamamla" : "Talebi tamamla"}
                  </button>
                  <button type="button" className={btn} onClick={() => setOpenId(null)}>Vazgeç</button>
                </div>
              </form>
            ) : null}
          </li>
        ))}
      </ul>
      <Feedback state={act.state} />
    </InlineArea>
  );
}
