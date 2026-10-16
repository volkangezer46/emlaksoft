import { notFound } from "next/navigation";
import Link from "@/components/ui/smart-link";
import { ArrowLeft, Building2, FileText, Home, ShieldCheck, StickyNote, UserRound, Users, Wallet } from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { ContactActions } from "@/components/app/detail-tabs";
import { formatPhoneDisplay } from "@/lib/phone";
import { formatDateTr, formatTry } from "@/lib/format";
import { daysFromNowIso } from "@/lib/clock";
import {
  AFFORDABILITY_LABELS,
  APPLICATION_DOC_LABELS,
  APPLICATION_STATUS_LABELS,
  APPLICATION_STATUS_TONES,
  affordability,
  isApplicationDocType,
  isApplicationStatus,
  ratioLabel,
  rentToIncomeRatio,
} from "@/lib/rentals/applications";
import { ApplicationStatusActions, ConvertActions, FileOpenButton, OfficeNoteEditor } from "./application-actions";

export const metadata = { title: "Kiracı başvurusu" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Rel<T> = T | T[] | null;
const one = <T,>(v: Rel<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

const AFF_BOX = {
  comfortable: "border-mint-500/30 bg-mint-500/8 text-mint-700",
  borderline: "border-amber-400/40 bg-amber-400/10 text-amber-700",
  risky: "border-danger-500/30 bg-danger-500/6 text-danger-600",
  unknown: "border-line bg-canvas text-text-muted",
} as const;

function Section({ icon: Icon, title, children }: { icon: typeof Users; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)] md:p-5">
      <h2 className="flex items-center gap-2 font-display text-sm font-bold text-ink-950">
        <Icon className="h-4 w-4 text-brand-600" aria-hidden="true" /> {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-4 gap-y-0.5 py-1.5 text-sm">
      <dt className="text-text-muted">{label}</dt>
      <dd className="min-w-0 text-right font-semibold text-ink-950">{value}</dd>
    </div>
  );
}

/** Kiracı başvurusu detayı (SP5): aday + ödeme gücü + kefil + evrak + durum akışı + malik kararı + KVKK izi. */
export default async function BasvuruDetayPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ perms, tenantId }, { id }] = await Promise.all([requireModulePage("rentals", "/app/kiralama"), params]);
  if (!UUID_RE.test(id)) notFound();
  const canEdit = perms.rentals?.includes("edit") ?? false;
  const canCreateRental = (perms.rentals?.includes("create") ?? false) && (perms.commissions?.includes("create") ?? false);

  const supabase = await createClient();
  const [{ data: app }, { data: files }] = await Promise.all([
    supabase
      .from("rental_applications")
      .select(
        "id, full_name, phone, email, occupation, employer, monthly_income, household_size, has_pets, pets_note, smoker, move_in_date, message, guarantor_name, guarantor_phone, guarantor_relation, guarantor_occupation, guarantor_income, guarantor_address, kvkk_consent_at, status, status_changed_at, office_note, owner_decision, owner_note, owner_decided_at, customer_id, rental_id, retain_until, created_at, property:properties!rental_applications_property_id_fkey(id, title, property_code, list_price), link:rental_application_links!rental_applications_link_id_fkey(asking_rent)",
      )
      .eq("id", id)
      .eq("tenant_id", tenantId ?? "")
      .maybeSingle(),
    supabase
      .from("rental_application_files")
      .select("id, doc_type, file_name, created_at")
      .eq("application_id", id)
      .eq("tenant_id", tenantId ?? "")
      .eq("status", "verified")
      .order("created_at"),
  ]);
  if (!app) notFound();
  const property = one(app.property as Rel<{ id: string; title: string | null; property_code: string | null; list_price: number | string | null }>);
  const link = one(app.link as Rel<{ asking_rent: number | string | null }>);
  const rent = link?.asking_rent != null ? Number(link.asking_rent) : property?.list_price != null ? Number(property.list_price) : null;
  const income = app.monthly_income != null ? Number(app.monthly_income) : null;
  const ratio = rentToIncomeRatio(rent, income);
  const aff = affordability(ratio);
  const status = isApplicationStatus(app.status) ? app.status : "new";

  const { data: ownerPortal } = property
    ? await supabase.from("owner_portal_tokens").select("id").eq("property_id", property.id).gt("expires_at", daysFromNowIso(0)).limit(1).maybeSingle()
    : { data: null };

  return (
    <div className="space-y-6 pb-24 lg:pb-0">
      <Link href="/app/kiralama/basvurular" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-text-muted transition hover:text-brand-600">
        <ArrowLeft className="h-4 w-4" /> Kiracı başvuruları
      </Link>
      <PageHeader
        title={app.full_name}
        eyebrow="Kiracı başvurusu"
        description={`${property?.title ?? property?.property_code ?? "Portföy"} · ${formatDateTr(app.created_at, { day: "2-digit", month: "long", year: "numeric" })}`}
        meta={<Badge variant={APPLICATION_STATUS_TONES[status]}>{APPLICATION_STATUS_LABELS[status]}</Badge>}
        actions={
          <>
            <ApplicationStatusActions id={app.id} status={status} canEdit={canEdit} />
            {status === "approved" && canEdit && property ? (
              <ConvertActions id={app.id} customerId={app.customer_id} propertyId={property.id} rent={rent} rentalId={app.rental_id} canCreateRental={canCreateRental} />
            ) : null}
          </>
        }
      />

      {status === "owner_review" ? (
        <p className="rounded-[var(--radius-card)] border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-sm text-amber-800">
          Malik kararı bekleniyor.{" "}
          {ownerPortal ? "Aday malik portalında görünüyor." : (
            <>
              Bu portföyün açık malik portalı bağlantısı yok —{" "}
              <Link href={`/app/portfoyler/${property?.id ?? ""}`} className="font-semibold underline underline-offset-2">portföyden malik portalını paylaşın</Link>{" "}
              ya da malik onayını telefonla alıp “Malik adına onayla”yı kullanın.
            </>
          )}
        </p>
      ) : null}
      {app.owner_decision ? (
        <p className={`rounded-[var(--radius-card)] border px-4 py-3 text-sm ${app.owner_decision === "approved" ? "border-mint-500/30 bg-mint-500/8 text-mint-800" : "border-danger-500/30 bg-danger-500/6 text-danger-700"}`}>
          Malik {app.owner_decision === "approved" ? "onayladı" : "reddetti"}
          {app.owner_decided_at ? ` · ${formatDateTr(app.owner_decided_at, { day: "2-digit", month: "long" })}` : ""}
          {app.owner_note ? ` — “${app.owner_note}”` : ""}
        </p>
      ) : null}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-4">
          <Section icon={Wallet} title="Ödeme gücü">
            <div className={`rounded-[var(--radius-card)] border px-4 py-3 ${AFF_BOX[aff]}`}>
              <p className="text-sm font-bold">{ratio != null ? `Kira gelirin ${ratioLabel(ratio)}'i · ${AFFORDABILITY_LABELS[aff]}` : "Gelir bilgisi yok"}</p>
              <p className="mt-0.5 text-xs opacity-90">Ölçüt: kira net gelirin üçte birini aşmamalı (≤ %33 rahat, ≤ %45 sınırda).</p>
            </div>
            <dl className="mt-3 divide-y divide-line">
              <Row label="Aylık kira" value={rent != null ? formatTry(rent) : "—"} />
              <Row label="Aylık net gelir" value={income != null ? formatTry(income) : "Belirtilmedi"} />
              <Row label="Meslek" value={[app.occupation, app.employer].filter(Boolean).join(" · ") || "Belirtilmedi"} />
            </dl>
          </Section>

          <Section icon={Home} title="Ev ve taşınma">
            <dl className="divide-y divide-line">
              <Row label="Hane" value={app.household_size ? `${app.household_size} kişi` : "Belirtilmedi"} />
              <Row label="Evcil hayvan" value={app.has_pets ? (app.pets_note || "Var") : "Yok"} />
              <Row label="Sigara" value={app.smoker ? "İçiyor" : "İçmiyor"} />
              <Row label="Taşınma tarihi" value={app.move_in_date ? formatDateTr(app.move_in_date, { day: "2-digit", month: "long", year: "numeric" }) : "Belirtilmedi"} />
            </dl>
            {app.message ? <p className="mt-3 whitespace-pre-wrap rounded-[var(--radius-card)] bg-canvas px-3 py-2 text-sm text-ink-950">“{app.message}”</p> : null}
          </Section>

          <Section icon={Users} title="Kefil">
            {app.guarantor_name ? (
              <dl className="divide-y divide-line">
                <Row label="Ad soyad" value={app.guarantor_name} />
                <Row label="Yakınlık" value={app.guarantor_relation ?? "Belirtilmedi"} />
                <Row label="Telefon" value={app.guarantor_phone ? <a href={`tel:${app.guarantor_phone}`} className="underline underline-offset-2">{formatPhoneDisplay(app.guarantor_phone)}</a> : "Belirtilmedi"} />
                <Row label="Meslek" value={app.guarantor_occupation ?? "Belirtilmedi"} />
                <Row label="Aylık gelir" value={app.guarantor_income != null ? formatTry(Number(app.guarantor_income)) : "Belirtilmedi"} />
                {app.guarantor_address ? <Row label="Adres" value={app.guarantor_address} /> : null}
              </dl>
            ) : (
              <p className="text-sm text-amber-700">Aday kefil bilgisi vermedi. Malik kefil istiyorsa adaydan isteyin.</p>
            )}
            <p className="mt-3 text-xs text-text-muted">Kira kaydı açılınca kefil sözleşmeye ({"{kefil}"}) taşınır. Kefalet, ıslak imzalı ayrı kefalet belgesiyle de alınmalıdır.</p>
          </Section>

          <Section icon={FileText} title={`Evrak (${(files ?? []).length})`}>
            {(files ?? []).length === 0 ? (
              <p className="text-sm text-text-muted">Aday evrak yüklemedi.</p>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {(files ?? []).map((f) => (
                  <li key={f.id}>
                    <FileOpenButton fileId={f.id} label={`${isApplicationDocType(f.doc_type) ? APPLICATION_DOC_LABELS[f.doc_type] : "Belge"} · ${f.file_name}`} />
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section icon={StickyNote} title="Ofis notu">
            <OfficeNoteEditor id={app.id} initial={app.office_note ?? ""} canEdit={canEdit} />
          </Section>
        </div>

        <aside aria-label="Aday iletişim" className="space-y-4 lg:sticky lg:top-4">
          <Section icon={UserRound} title="İletişim">
            <p className="text-sm font-semibold text-ink-950">{formatPhoneDisplay(app.phone)}</p>
            {app.email ? <p className="text-xs text-text-muted">{app.email}</p> : null}
            <div className="mt-3">
              <ContactActions
                phone={app.phone}
                name={app.full_name}
                appointmentHref={app.customer_id ? `/app/randevular?customer=${app.customer_id}${property ? `&property=${property.id}` : ""}` : null}
              />
            </div>
          </Section>
          {property ? (
            <Section icon={Building2} title="Portföy">
              <Link href={`/app/portfoyler/${property.id}`} className="focus-ring block rounded-[var(--radius-control)] text-sm font-semibold text-ink-950 hover:underline">
                {property.title ?? property.property_code}
              </Link>
              <Link href={`/app/kiralama/basvurular?portfoy=${property.id}`} className="mt-2 inline-flex min-h-11 items-center text-xs font-semibold text-brand-600 hover:underline">
                Bu portföyün tüm başvuruları
              </Link>
            </Section>
          ) : null}
          <Section icon={ShieldCheck} title="KVKK">
            <dl className="divide-y divide-line text-xs">
              <Row label="Aydınlatma onayı" value={formatDateTr(app.kvkk_consent_at, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })} />
              <Row label="Saklama sonu" value={formatDateTr(app.retain_until, { day: "2-digit", month: "short", year: "numeric" })} />
            </dl>
          </Section>
        </aside>
      </div>
    </div>
  );
}
