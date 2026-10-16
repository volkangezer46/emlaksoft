import Link from "@/components/ui/smart-link";
import { ArrowLeft, Columns3, Star } from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyStateV3 } from "@/components/ui/empty-state";
import { formatTry } from "@/lib/format";
import {
  APPLICATION_STATUS_LABELS,
  APPLICATION_STATUS_TONES,
  buildComparison,
  isApplicationStatus,
  parseCompareIds,
  type ComparableApplication,
} from "@/lib/rentals/applications";
import { CompareBulkActions } from "./compare-actions";

export const metadata = { title: "Aday karşılaştırma" };

type Rel<T> = T | T[] | null;
const one = <T,>(v: Rel<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

const TONE = { good: "text-mint-700", warn: "text-amber-700", bad: "text-danger-600" } as const;

/**
 * Kiracı adaylarını yan yana karşılaştırma (SP5). Satırlar SAF modelden (buildComparison): "en iyi" işareti yalnız
 * ölçülebilir satırlarda ve en az iki adayda veri varken. Mobilde tablo kendi kutusunda yatay kayar (sayfa taşmaz),
 * ilk sütun yapışkan.
 */
export default async function KarsilastirPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ perms, tenantId }, sp] = await Promise.all([requireModulePage("rentals", "/app/kiralama"), searchParams]);
  const canEdit = perms.rentals?.includes("edit") ?? false;
  const ids = parseCompareIds(sp.ids);

  const supabase = await createClient();
  const { data } = ids.length
    ? await supabase
        .from("rental_applications")
        .select(
          "id, full_name, occupation, employer, monthly_income, household_size, has_pets, smoker, move_in_date, guarantor_name, guarantor_income, file_count, status, created_at, property:properties!rental_applications_property_id_fkey(id, title, property_code, list_price), link:rental_application_links!rental_applications_link_id_fkey(asking_rent)",
        )
        .eq("tenant_id", tenantId ?? "")
        .in("id", ids)
    : { data: [] };
  type Row = ComparableApplication & { property: Rel<{ id: string; title: string | null; property_code: string | null; list_price: number | string | null }>; link: Rel<{ asking_rent: number | string | null }> };
  const rows = ((data ?? []) as unknown as Row[])
    .sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id))
    .map((r) => {
      const p = one(r.property);
      const l = one(r.link);
      return {
        ...r,
        status: isApplicationStatus(r.status) ? r.status : ("new" as const),
        monthly_income: r.monthly_income != null ? Number(r.monthly_income) : null,
        guarantor_income: r.guarantor_income != null ? Number(r.guarantor_income) : null,
        monthly_rent: l?.asking_rent != null ? Number(l.asking_rent) : p?.list_price != null ? Number(p.list_price) : null,
        propertyLabel: p?.title ?? p?.property_code ?? "Portföy",
      };
    });

  const back = (
    <Link href="/app/kiralama/basvurular" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-text-muted transition hover:text-brand-600">
      <ArrowLeft className="h-4 w-4" /> Kiracı başvuruları
    </Link>
  );

  if (rows.length < 2) {
    return (
      <div className="space-y-6">
        {back}
        <PageHeader title="Aday karşılaştırma" eyebrow="Kiracı başvuruları" />
        <EmptyStateV3
          icon={Columns3}
          title="Karşılaştırmak için en az iki aday seçin."
          description="Başvuru listesinde aday kartlarının solundaki kutucukla 2-4 aday seçip “Yan yana karşılaştır”a dokunun."
          action={{ label: "Başvurulara dön", href: "/app/kiralama/basvurular" }}
        />
      </div>
    );
  }

  const samePropertyRent = new Set(rows.map((r) => r.monthly_rent)).size === 1 ? rows[0]!.monthly_rent : null;
  const table = buildComparison(rows, samePropertyRent);

  return (
    <div className="space-y-6">
      {back}
      <PageHeader
        title="Aday karşılaştırma"
        eyebrow="Kiracı başvuruları"
        description={samePropertyRent != null ? `Aylık kira ${formatTry(samePropertyRent)} üzerinden. ★ en iyi değeri gösterir.` : "Adaylar farklı ilanlara başvurdu; kira/gelir her adayın kendi ilanına göre. ★ en iyi değeri gösterir."}
        actions={canEdit ? <CompareBulkActions ids={rows.map((r) => r.id)} /> : null}
      />

      <div className="overflow-x-auto rounded-[var(--radius-panel)] border border-line bg-surface shadow-[var(--shadow-xs)]">
        <table className="w-full min-w-[36rem] border-collapse text-sm">
          <caption className="sr-only">Kiracı adaylarının yan yana karşılaştırması</caption>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="sticky left-0 z-10 w-36 bg-surface px-3 py-3 text-left text-xs font-semibold uppercase tracking-[0.06em] text-text-muted">
                Ölçüt
              </th>
              {rows.map((r) => (
                <th key={r.id} scope="col" className="min-w-[10rem] px-3 py-3 text-left align-top">
                  <Link href={`/app/kiralama/basvurular/${r.id}`} className="focus-ring block rounded-[var(--radius-control)] font-semibold text-ink-950 hover:underline">
                    {r.full_name}
                  </Link>
                  <span className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Badge variant={APPLICATION_STATUS_TONES[r.status]} size="sm">{APPLICATION_STATUS_LABELS[r.status]}</Badge>
                  </span>
                  {samePropertyRent == null ? <span className="mt-1 block truncate text-xs font-normal text-text-muted">{r.propertyLabel}</span> : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.map((row) => (
              <tr key={row.label} className="border-b border-line last:border-0">
                <th scope="row" className="sticky left-0 z-10 bg-surface px-3 py-2.5 text-left text-xs font-semibold text-text-muted">
                  {row.label}
                </th>
                {row.cells.map((c, i) => (
                  <td key={rows[i]!.id} className={`px-3 py-2.5 ${c.best ? "bg-mint-500/8" : ""}`}>
                    <span className={`inline-flex items-center gap-1 ${c.tone ? TONE[c.tone] : "text-ink-950"} ${c.best ? "font-bold" : ""}`}>
                      {c.best ? <Star className="h-3.5 w-3.5 fill-current text-mint-600" aria-label="En iyi" /> : null}
                      {c.text}
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-text-muted">
        Karşılaştırma yalnız adayın beyanına dayanır; gelir ve kimliği evrakla doğrulayın. Telefon ve e-posta malike gösterilmez.
      </p>
    </div>
  );
}
