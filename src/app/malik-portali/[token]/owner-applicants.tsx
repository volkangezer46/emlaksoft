import type { SupabaseClient } from "@supabase/supabase-js";
import { Users } from "lucide-react";
import { PortalSection } from "@/components/public/portal-kit";
import { formatDateTr, formatTry } from "@/lib/format";
import { now } from "@/lib/clock";
import { AFFORDABILITY_LABELS, affordability, ratioLabel, rentToIncomeRatio } from "@/lib/rentals/applications";
import { OwnerApplicantDecision } from "./owner-applicant-decision";

type Row = {
  id: string;
  full_name: string;
  occupation: string | null;
  monthly_income: number | string | null;
  household_size: number | null;
  has_pets: boolean;
  pets_note: string | null;
  smoker: boolean;
  move_in_date: string | null;
  guarantor_name: string | null;
  guarantor_relation: string | null;
  guarantor_income: number | string | null;
  file_count: number;
  status: string;
  owner_decision: string | null;
  owner_decided_at: string | null;
  link: { asking_rent: number | string | null } | { asking_rent: number | string | null }[] | null;
};

const RECENT_MS = 30 * 86_400_000;
const AFF_TONE = { comfortable: "text-mint-700", borderline: "text-amber-700", risky: "text-danger-600", unknown: "text-text-muted" } as const;

/** Ad + soyadın baş harfi: malik kararı için yeterli, ekran görüntüsünde tam ad dolaşmaz. */
function shortName(full: string): string {
  const parts = full.trim().split(/\s+/);
  if (parts.length < 2) return parts[0] ?? "Aday";
  return `${parts.slice(0, -1).join(" ")} ${parts[parts.length - 1]!.charAt(0).toLocaleUpperCase("tr-TR")}.`;
}

/**
 * Malik portalı "Önerilen kiracı adayları" (SP5). Token sayfada doğrulandı; sorgu token'ın portföyüne ve ofisine sabit.
 * Malike telefon/e-posta/evrak GÖSTERİLMEZ (KVKK: değerlendirme için gerekli asgari veri): meslek, gelir, kira/gelir oranı,
 * hane, kefil özeti, evrak sayısı. Karar: onay / ret (+ not). Tablo yoksa bölüm gizlenir.
 */
export async function OwnerApplicantsSection({
  db,
  tenantId,
  propertyId,
  token,
  listPrice,
}: {
  db: SupabaseClient;
  tenantId: string;
  propertyId: string;
  token: string;
  listPrice: number | null;
}) {
  const { data, error } = await db
    .from("rental_applications")
    .select(
      "id, full_name, occupation, monthly_income, household_size, has_pets, pets_note, smoker, move_in_date, guarantor_name, guarantor_relation, guarantor_income, file_count, status, owner_decision, owner_decided_at, link:rental_application_links!rental_applications_link_id_fkey(asking_rent)",
    )
    .eq("tenant_id", tenantId)
    .eq("property_id", propertyId)
    .eq("is_sample", false)
    .in("status", ["owner_review", "approved", "rejected"])
    .order("created_at", { ascending: false })
    .limit(12);
  if (error || !data) return null;
  const nowMs = now();
  const rows = (data as unknown as Row[]).filter(
    (r) => r.status === "owner_review" || (r.owner_decision && r.owner_decided_at && nowMs - Date.parse(r.owner_decided_at) < RECENT_MS),
  );
  if (rows.length === 0) return null;
  const pending = rows.filter((r) => r.status === "owner_review");

  return (
    <PortalSection id="kiraci-adaylari" icon={Users} title="Önerilen kiracı adayları" iconClassName="text-brand-600">
      {pending.length > 0 ? (
        <p className="mb-3 text-sm text-text-muted">
          Danışmanınız {pending.length} adayı değerlendirmenize sundu. Uygun bulduğunuz adayı onaylayın; danışmanınız sözleşme için sizinle iletişime geçer.
        </p>
      ) : null}
      <ul className="grid gap-3 sm:grid-cols-2">
        {rows.map((r) => {
          const link = Array.isArray(r.link) ? r.link[0] : r.link;
          const rent = link?.asking_rent != null ? Number(link.asking_rent) : listPrice;
          const income = r.monthly_income != null ? Number(r.monthly_income) : null;
          const ratio = rentToIncomeRatio(rent, income);
          const aff = affordability(ratio);
          return (
            <li key={r.id} className="rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)]">
              <p className="font-display text-base font-bold text-ink-950">{shortName(r.full_name)}</p>
              <p className="text-xs text-text-muted">{r.occupation ?? "Meslek belirtilmedi"}</p>
              <dl className="mt-3 space-y-1.5 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-text-muted">Aylık net gelir</dt>
                  <dd className="numeric font-semibold text-ink-950">{income != null ? formatTry(income) : "Belirtilmedi"}</dd>
                </div>
                {ratio != null ? (
                  <div className="flex justify-between gap-3">
                    <dt className="text-text-muted">Kira / gelir</dt>
                    <dd className={`font-semibold ${AFF_TONE[aff]}`}>{ratioLabel(ratio)} · {AFFORDABILITY_LABELS[aff]}</dd>
                  </div>
                ) : null}
                <div className="flex justify-between gap-3">
                  <dt className="text-text-muted">Hane</dt>
                  <dd className="font-semibold text-ink-950">
                    {r.household_size ? `${r.household_size} kişi` : "—"}
                    {r.has_pets ? ` · evcil hayvan${r.pets_note ? ` (${r.pets_note})` : ""}` : ""}
                    {r.smoker ? " · sigara" : ""}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-text-muted">Kefil</dt>
                  <dd className="text-right font-semibold text-ink-950">
                    {r.guarantor_name
                      ? `${r.guarantor_relation ?? "Var"}${r.guarantor_income != null ? ` · ${formatTry(Number(r.guarantor_income))}` : ""}`
                      : "Yok"}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-text-muted">Evrak</dt>
                  <dd className="font-semibold text-ink-950">{r.file_count > 0 ? `${r.file_count} belge ofiste` : "Yüklenmedi"}</dd>
                </div>
                {r.move_in_date ? (
                  <div className="flex justify-between gap-3">
                    <dt className="text-text-muted">Taşınma</dt>
                    <dd className="font-semibold text-ink-950">{formatDateTr(r.move_in_date, { day: "2-digit", month: "long" })}</dd>
                  </div>
                ) : null}
              </dl>
              <div className="mt-4">
                {r.status === "owner_review" ? (
                  <OwnerApplicantDecision token={token} applicationId={r.id} name={shortName(r.full_name)} />
                ) : (
                  <p className={`text-sm font-semibold ${r.owner_decision === "approved" ? "text-mint-700" : "text-text-muted"}`}>
                    {r.owner_decision === "approved" ? "Onayladınız" : "Reddettiniz"}
                    {r.owner_decided_at ? ` · ${formatDateTr(r.owner_decided_at, { day: "2-digit", month: "long" })}` : ""}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </PortalSection>
  );
}
