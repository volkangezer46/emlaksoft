"use client";

import { useMemo, useState, useTransition } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { Check, Copy, Info, KeyRound, Mail, UserCheck } from "lucide-react";
import { TAB_ICONS as TI } from "@/lib/icons";
import { createAdvisor, type CreateAdvisorResult } from "../invite-actions";
import { clearFormDraft } from "@/components/app/use-form-draft";
import { useToast } from "@/components/app/toast-provider";
import { MODULE_LABELS } from "@/app/app/ayarlar/roller/role-permissions-matrix";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { EmailInput } from "@/components/ui/email-input";
import { FormField, FormInput, FormSelect } from "@/components/ui/form-controls";
import { PageHeader } from "@/components/ui/page-header";
import { PhoneInput } from "@/components/ui/phone-input";
import { SummaryGroup, SummaryRow, TabbedFormShell, type FormTab, type TabbedSummaryContext } from "@/components/ui/tabbed-form-shell";
import { hasOfficeWideDataScope } from "@/lib/permission-data-scope";
import type { AppModule } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { ADVISOR_DRAFT_FIELDS, ADVISOR_FORM_ID, ADVISOR_TABS, type InviteMode } from "./advisor-tabs";

export type RolePermissionSummary = {
  role: string;
  permissions: Record<string, string[]>;
  seesAllEarnings: boolean;
};

type Branch = { id: string; name: string };

const TAB_ICONS = {
  kimlik: TI.kisi,
  yetki: TI.yetki,
  atama: TI.taraflar,
  hedef: TI.hedef,
  davet: TI.kanal,
} as const;

const ROLE_META: Record<string, { label: string; blurb: string }> = {
  gm: { label: "Genel müdür", blurb: "Ofisin tamamını yönetir; ekip ve ayarlarda geniş yetki." },
  branch_manager: { label: "Şube müdürü", blurb: "Şubesini ve ekibini yönetir, ofis geneli veriyi görür." },
  team_lead: { label: "Takım lideri", blurb: "Saha danışmanı yetkileri; kendi kayıtlarıyla çalışır." },
  advisor: { label: "Danışman", blurb: "Kendi müşteri, portföy ve randevularını yönetir." },
  call_center: { label: "Çağrı merkezi", blurb: "Talep karşılama, arama ve randevu kaydı." },
  accounting: { label: "Muhasebe", blurb: "Komisyon, gider ve kazanç raporları." },
  readonly: { label: "Salt okunur", blurb: "Yalnız görüntüleme; hiçbir kaydı değiştiremez." },
};

const ACTION_LABEL: Record<string, string> = { view: "Görüntüle", create: "Ekle", edit: "Düzenle", delete: "Sil" };
const ACTION_ORDER = ["view", "create", "edit", "delete"];

function poolInfo(role: string): { included: boolean; text: string } {
  if (role === "advisor" || role === "team_lead") {
    return { included: true, text: "Dahil: gelen talepler aktif danışmanlar arasında en az yüklü olana otomatik atanır." };
  }
  if (role === "gm" || role === "branch_manager") {
    return { included: false, text: "Yalnız ofiste aktif danışman/takım lideri yoksa yedek olarak havuza girer." };
  }
  return { included: false, text: "Dahil değil: bu rol otomatik talep atamasına alınmaz." };
}

export function AdvisorForm({
  userId,
  officeName,
  branches,
  rolePermissions,
  seats,
  canSetTargets,
}: {
  userId: string;
  officeName: string;
  branches: Branch[];
  rolePermissions: RolePermissionSummary[];
  seats: { used: number; limit: number } | null;
  canSetTargets: boolean;
}) {
  const roles = rolePermissions.map((r) => r.role);
  const [role, setRole] = useState(roles.includes("advisor") ? "advisor" : (roles[0] ?? ""));
  const [mode, setMode] = useState<InviteMode>("email");
  const [fullName, setFullName] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<CreateAdvisorResult | null>(null);
  const [copied, setCopied] = useState(false);
  const { push } = useToast();

  const remaining = seats ? Math.max(0, seats.limit - seats.used) : null;
  const seatsFull = seats !== null && seats.used >= seats.limit;
  const selected = rolePermissions.find((r) => r.role === role) ?? null;

  const tabs: FormTab[] = useMemo(
    () =>
      ADVISOR_TABS.map((t) => ({
        id: t.id,
        label: t.label,
        description: t.description,
        icon: TAB_ICONS[t.id],
        fields: [...t.fields],
        required: [...t.required],
      })),
    [],
  );

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (seatsFull) return;
    const fd = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await createAdvisor(fd);
      if (!result.ok) {
        setError(result.error ?? "Danışman eklenemedi.");
        return;
      }
      setError(null);
      clearFormDraft(userId, ADVISOR_FORM_ID);
      push("Danışman eklendi", "ok");
      setDone(result);
    });
  }

  async function copyPassword(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  if (done) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <PageHeader
          title="Danışman eklendi"
          eyebrow="Ekip & yetkiler"
          description={`${fullName.trim() || "Yeni üye"} artık ofisinizin aktif kullanıcısı.`}
        />
        {done.tempPassword ? (
          <div className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <p className="flex items-center gap-2 text-sm font-semibold text-ink-950">
              <KeyRound className="h-4 w-4" aria-hidden /> Geçici parola (yalnız bir kez gösterilir)
            </p>
            <div className="mt-3 flex items-center gap-2">
              <code className="numeric flex-1 select-all rounded-[var(--radius-control)] bg-canvas px-3 py-2.5 text-base tracking-wider text-ink-950">
                {done.tempPassword}
              </code>
              <button
                type="button"
                onClick={() => copyPassword(done.tempPassword ?? "")}
                className="focus-ring press inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-line px-3 py-2.5 text-xs font-semibold text-text-muted hover:border-brand-300 hover:text-brand-600"
              >
                {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
                {copied ? "Kopyalandı" : "Kopyala"}
              </button>
            </div>
            <p className="mt-3 text-xs text-text-muted">
              Parolayı e-posta veya mesaj yerine yüz yüze ya da şifreli bir kanalla iletin; ilk girişte değiştirmesini isteyin.
              Bu sayfadan ayrıldığınızda parola tekrar görüntülenemez.
            </p>
          </div>
        ) : (
          <Alert tone={done.emailSent ? "success" : "warning"} title={done.emailSent ? "Davet e-postası gönderildi" : "Davet e-postası gönderilemedi"}>
            {done.emailSent
              ? "Danışman e-postasındaki bağlantıyla kendi parolasını belirleyip giriş yapabilir."
              : "Ekip listesinden \"Daveti yinele\" ile tekrar deneyebilirsiniz."}
          </Alert>
        )}
        {done.warnings?.map((w) => (
          <Alert key={w} tone="warning">{w}</Alert>
        ))}
        <div className="flex flex-wrap gap-2">
          <ButtonLink href="/app/ekip" variant="secondary">Ekip listesine dön</ButtonLink>
          {done.id ? <ButtonLink href={`/app/ekip/${done.id}`} icon={UserCheck}>Danışman profilini aç</ButtonLink> : null}
        </div>
      </div>
    );
  }

  const tabPanels = {
    kimlik: (
      <>
        <FormField label="Ad soyad" htmlFor="adv-name" required className="sm:col-span-2">
          <FormInput
            name="full_name"
            required
            maxLength={120}
            placeholder="Örn. Merve Akın"
            autoComplete="off"
            onChange={(e) => setFullName(e.target.value)}
          />
        </FormField>
        <FormField label="Telefon" htmlFor="adv-phone">
          <PhoneInput name="phone" />
        </FormField>
        <FormField label="E-posta" htmlFor="adv-email" required hint="Giriş ve davet bu adresle yapılır.">
          <EmailInput name="email" required placeholder="danisman@ofis.com" />
        </FormField>
        <FormField label="Unvan" htmlFor="adv-title" required className="sm:col-span-2" hint="Kartvizit ve ekip listesinde görünür (örn. Gayrimenkul Danışmanı).">
          <FormInput name="title" required maxLength={80} placeholder="Gayrimenkul Danışmanı" />
        </FormField>
      </>
    ),
    yetki: (
      <>
        <fieldset className="sm:col-span-2">
          <legend className="mb-2 text-sm font-medium text-ink-950">Rol</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {rolePermissions.map((r) => {
              const meta = ROLE_META[r.role] ?? { label: r.role, blurb: "" };
              const on = r.role === role;
              return (
                <label
                  key={r.role}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-[var(--radius-card)] border p-3 transition focus-within:ring-2 focus-within:ring-brand-400",
                    on ? "border-brand-500 bg-brand-600/5" : "border-line bg-surface hover:border-brand-300",
                  )}
                >
                  <input
                    type="radio"
                    name="role"
                    value={r.role}
                    checked={on}
                    onChange={() => setRole(r.role)}
                    className="mt-1 accent-[var(--brand-600)]"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-ink-950">{meta.label}</span>
                    <span className="mt-0.5 block text-xs text-text-muted">{meta.blurb}</span>
                  </span>
                </label>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-text-faint">
            Yalnız kendi seviyenizin altındaki roller verilebilir; ofis sahibi rolü atanamaz.
          </p>
        </fieldset>
        {selected ? <RoleMatrix summary={selected} /> : null}
      </>
    ),
    atama: (
      <>
        <FormField label="Şube" htmlFor="adv-branch" className="sm:col-span-2">
          <FormSelect name="branch_id" defaultValue="">
            <option value="">Şube atanmadı</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </FormSelect>
        </FormField>
        <div className="space-y-2 sm:col-span-2">
          <InfoRow
            title="Veri görünürlüğü"
            text={
              hasOfficeWideDataScope(role)
                ? "Bu rol ofis genelindeki müşteri ve portföyleri görür."
                : "Bu rol yalnız kendisine atanan müşteri, portföy ve anlaşmaları görür."
            }
          />
          <InfoRow title="Otomatik talep dağıtımı" text={poolInfo(role).text} />
          <p className="text-xs text-text-muted">
            Görünürlük rolden gelir; dağıtım kuralları için{" "}
            <Link href="/app/ayarlar/lead" className="font-semibold text-brand-600 hover:underline">talep ayarları</Link>,
            kişiye özel yetki istisnası için{" "}
            <Link href="/app/ayarlar/roller" className="font-semibold text-brand-600 hover:underline">izin matrisi</Link>.
          </p>
        </div>
      </>
    ),
    hedef: (
      <>
        {canSetTargets ? null : (
          <div className="sm:col-span-2">
            <Alert tone="info">Hedef atamak için hedefler modülünde ekleme yetkisi gerekir; bu alanlar boş bırakılmalıdır.</Alert>
          </div>
        )}
        <FormField label="Aylık anlaşma hedefi" htmlFor="adv-deals" hint="Adet; boş bırakırsanız hedef oluşturulmaz.">
          <FormInput name="target_deals" type="number" min={0} max={10000} step={1} inputMode="numeric" placeholder="Örn. 3" disabled={!canSetTargets} />
        </FormField>
        <FormField label="Aylık ciro hedefi (TL)" htmlFor="adv-revenue" hint="Brüt komisyon cirosu.">
          <FormInput name="target_revenue" type="number" min={0} step={1000} inputMode="decimal" placeholder="Örn. 250000" disabled={!canSetTargets} />
        </FormField>
        <p className="text-xs text-text-muted sm:col-span-2">
          Hedef bu ayın başından geçerli aylık hedef olarak kaydedilir; gerçekleşme canlı veriden hesaplanır ve{" "}
          <Link href="/app/hedefler" className="font-semibold text-brand-600 hover:underline">Hedefler</Link> sayfasında izlenir.
        </p>
      </>
    ),
    davet: (
      <>
        <fieldset className="sm:col-span-2">
          <legend className="mb-2 text-sm font-medium text-ink-950">Hesap teslimi</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                { value: "email", icon: Mail, title: "E-posta daveti", blurb: "Danışmana parola belirleme bağlantısı gönderilir; parolayı siz görmezsiniz." },
                { value: "password", icon: KeyRound, title: "Geçici parola üret", blurb: "Parola oluşturulur ve kayıttan sonra size bir kez gösterilir; siz iletirsiniz." },
              ] as const
            ).map((o) => (
              <label
                key={o.value}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-[var(--radius-card)] border p-3 transition focus-within:ring-2 focus-within:ring-brand-400",
                  mode === o.value ? "border-brand-500 bg-brand-600/5" : "border-line bg-surface hover:border-brand-300",
                )}
              >
                <input
                  type="radio"
                  name="invite_mode"
                  value={o.value}
                  checked={mode === o.value}
                  onChange={() => setMode(o.value)}
                  className="mt-1 accent-[var(--brand-600)]"
                />
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-sm font-semibold text-ink-950">
                    <o.icon className="h-4 w-4" aria-hidden /> {o.title}
                  </span>
                  <span className="mt-0.5 block text-xs text-text-muted">{o.blurb}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="rounded-[var(--radius-card)] border border-line bg-canvas/60 p-4 sm:col-span-2">
          <p className="text-xs font-semibold text-ink-950">{mode === "email" ? "Davet metni önizlemesi" : "İletim notu"}</p>
          {mode === "email" ? (
            <p className="mt-2 whitespace-pre-line text-sm text-text-muted">
              {`Merhaba ${fullName.trim() || "…"},\n${officeName} ofisinde sizin için bir EmlakSoft hesabı açıldı. E-postanızdaki bağlantıyla parolanızı belirleyip giriş yapabilirsiniz.`}
            </p>
          ) : (
            <p className="mt-2 text-sm text-text-muted">
              Parola yalnız kayıt sonrası ekranda bir kez görünür ve hiçbir yerde saklanmaz. Yüz yüze ya da şifreli bir kanalla iletin,
              ilk girişte değiştirmesini isteyin; e-posta veya genel gruplarda paylaşmayın.
            </p>
          )}
        </div>
      </>
    ),
  };

  function renderSummary({ values, display }: TabbedSummaryContext) {
    const currentRole = (values.role ?? role) as string;
    const meta = ROLE_META[currentRole];
    const name = (values.full_name ?? "").trim();
    const title = (values.title ?? "").trim();
    const next = seats ? seats.used + 1 : null;
    return (
      <>
        <div className="rounded-[var(--radius-control)] border border-line bg-canvas/60 p-3">
          <p className="truncate text-sm font-semibold text-ink-950">{name || "Ad soyad girilmedi"}</p>
          <p className="mt-0.5 truncate text-xs text-text-muted">
            {[title || null, meta?.label ?? null].filter(Boolean).join(" · ") || "Unvan ve rol seçilmedi"}
          </p>
        </div>
        {seats ? (
          <div
            className={cn(
              "rounded-[var(--radius-control)] border p-3 text-xs",
              seatsFull ? "tone-danger" : "border-line bg-canvas/60",
            )}
          >
            <p className="font-semibold text-ink-950">
              <span className="numeric">{seats.used}/{seats.limit}</span> kullanıcı, kalan <span className="numeric">{remaining}</span>
            </p>
            {seatsFull ? (
              <p className="mt-1">
                Paket kullanıcı limitine ulaştınız; yeni danışman eklenemez.{" "}
                <Link href="/app/abonelik" className="font-semibold underline">Paketi yükseltin</Link> veya bir üyeyi pasife alın.
              </p>
            ) : (
              <p className="mt-1 text-text-muted">
                Bu danışmanla <span className="numeric">{next}/{seats.limit}</span> olur.{" "}
                <Link href="/app/abonelik" className="font-semibold text-brand-600 hover:underline">Paketi incele</Link>
              </p>
            )}
          </div>
        ) : null}
        <SummaryGroup title="Kişi bilgisi">
          <SummaryRow label="Ad soyad" value={name || "Zorunlu"} muted={!name} tab="kimlik" field="full_name" />
          <SummaryRow label="Telefon" value={display.phone ?? "Girilmedi"} muted={!display.phone} tab="kimlik" field="phone" />
          <SummaryRow label="E-posta" value={display.email ?? "Zorunlu"} muted={!display.email} tab="kimlik" field="email" />
          <SummaryRow label="Unvan" value={title || "Zorunlu"} muted={!title} tab="kimlik" field="title" />
          <SummaryRow label="Şube" value={display.branch_id ?? "Atanmadı"} muted={!display.branch_id} tab="atama" field="branch_id" />
        </SummaryGroup>
        <SummaryGroup title="Rol ve kapsam">
          <SummaryRow label="Rol" value={meta?.label ?? "Seçilmedi"} muted={!meta} tab="yetki" field="role" />
          <SummaryRow
            label="Görünürlük"
            value={hasOfficeWideDataScope(currentRole) ? "Ofis geneli" : "Yalnız kendi kayıtları"}
            tab="atama"
            field="branch_id"
          />
          <SummaryRow
            label="Otomatik atama"
            value={poolInfo(currentRole).included ? "Havuzda" : "Havuz dışı"}
            muted={!poolInfo(currentRole).included}
            tab="atama"
          />
          <SummaryRow
            label="Başkasının kazancı"
            value={rolePermissions.find((r) => r.role === currentRole)?.seesAllEarnings ? "Görür" : "Görmez"}
            muted={!rolePermissions.find((r) => r.role === currentRole)?.seesAllEarnings}
            tab="yetki"
          />
        </SummaryGroup>
      </>
    );
  }

  return (
    <TabbedFormShell
      title="Yeni danışman"
      description="Kimlik, rol, atama, hedef ve davet adımlarını tek yerden tamamlayın."
      eyebrow="Ekip & yetkiler"
      breadcrumbs={[{ label: "Ekip Merkezi", href: "/app/ekip" }, { label: "Yeni danışman" }]}
      cancelHref="/app/ekip"
      submitLabel="Danışmanı ekle"
      pendingLabel="Ekleniyor…"
      submitIcon={Check}
      submitDisabled={seatsFull}
      pending={pending}
      error={error}
      notice={
        seatsFull ? (
          <Alert
            tone="danger"
            title="Kullanıcı limitine ulaşıldı"
            action={<ButtonLink href="/app/abonelik" size="sm">Paketi yükselt</ButtonLink>}
          >
            Paketiniz en fazla {seats?.limit} aktif kullanıcı destekliyor.
          </Alert>
        ) : null
      }
      onSubmit={onSubmit}
      tabs={tabs}
      tabPanels={tabPanels}
      summary={renderSummary}
      fieldLabels={{ full_name: "Ad soyad", email: "E-posta", title: "Unvan", role: "Rol" }}
      draft={{ userId, formId: ADVISOR_FORM_ID, fields: [...ADVISOR_DRAFT_FIELDS] }}
    />
  );
}

function InfoRow({ title, text }: { title: string; text: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-[var(--radius-control)] border border-line bg-canvas/60 p-3">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
      <div className="min-w-0 text-sm">
        <p className="font-semibold text-ink-950">{title}</p>
        <p className="mt-0.5 text-xs text-text-muted">{text}</p>
      </div>
    </div>
  );
}

function RoleMatrix({ summary }: { summary: RolePermissionSummary }) {
  const rows = Object.entries(summary.permissions)
    .filter(([mod, actions]) => mod !== "earnings_all" && actions.length > 0)
    .sort(([a], [b]) => (MODULE_LABELS[a as AppModule] ?? a).localeCompare(MODULE_LABELS[b as AppModule] ?? b, "tr"));
  return (
    <div className="space-y-3 sm:col-span-2" aria-live="polite">
      <p className="text-sm font-medium text-ink-950">
        {ROLE_META[summary.role]?.label ?? summary.role} rolünün etkin izinleri
        <span className="ml-2 text-xs font-normal text-text-muted">(ofisin rol ayarlarıyla birlikte)</span>
      </p>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {rows.map(([mod, actions]) => (
          <div key={mod} className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2">
            <span className="truncate text-xs font-medium text-ink-950">{MODULE_LABELS[mod as AppModule] ?? mod}</span>
            <span className="flex shrink-0 flex-wrap justify-end gap-1">
              {ACTION_ORDER.filter((a) => actions.includes(a)).map((a) => (
                <span key={a} className="rounded-full bg-brand-600/10 px-1.5 py-0.5 text-xs font-semibold text-brand-600">
                  {ACTION_LABEL[a]}
                </span>
              ))}
            </span>
          </div>
        ))}
      </div>
      <Alert tone={summary.seesAllEarnings ? "warning" : "info"} title="Kazanç görünürlüğü">
        {summary.seesAllEarnings
          ? "Bu rol başkalarının komisyon ve kazançlarını da görür (earnings_all izni)."
          : "Bu rol yalnız kendi kazancını görür; başkasının payı için ayrı \"Başkasının kazancı\" izni gerekir (izin matrisinden açılır)."}
      </Alert>
    </div>
  );
}
