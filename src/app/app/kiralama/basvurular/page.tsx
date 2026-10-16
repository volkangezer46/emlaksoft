import Link from "@/components/ui/smart-link";
import { ArrowLeft, CheckCircle2, FileText, Inbox, Link2, ListChecks, ShieldCheck, Users } from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { createClient } from "@/lib/supabase/server";
import { assertQueryBatchSucceeded } from "@/lib/supabase/query-batch";
import { PageHeader } from "@/components/ui/page-header";
import { StatRow } from "@/components/ui/stat-row";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { EmptyStateV3 } from "@/components/ui/empty-state";
import { CategoryChips, ListPager, pageWindow, parsePage } from "@/components/ui/list-kit";
import { FilterChip } from "@/components/ui/filter-chip";
import { getBaseUrl } from "@/lib/base-url";
import { formatDateTr, formatTry } from "@/lib/format";
import { RENTAL_APPLICATION_STATUSES, OPEN_RENTAL_APPLICATION_STATUSES, type RentalApplicationStatus } from "@/lib/workflow-state";
import {
  AFFORDABILITY_LABELS,
  APPLICATION_STATUS_LABELS,
  APPLICATION_STATUS_TONES,
  affordability,
  applicationLinkPath,
  isApplicationStatus,
  ratioLabel,
  rentToIncomeRatio,
} from "@/lib/rentals/applications";
import { CompareCheckbox, CompareProvider, LinkActions, NewLinkPanel, NewLinkTrigger } from "./applications-client";

export const metadata = { title: "Kiracı başvuruları" };

const PATH = "/app/kiralama/basvurular";
const PAGE_SIZE = 30;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Rel<T> = T | T[] | null;
const one = <T,>(v: Rel<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
type PropRel = { id: string; title: string | null; property_code: string | null; list_price: number | string | null };
type AppRow = {
  id: string;
  full_name: string;
  occupation: string | null;
  monthly_income: number | string | null;
  guarantor_name: string | null;
  file_count: number;
  status: string;
  created_at: string;
  property: Rel<PropRel>;
  link: Rel<{ asking_rent: number | string | null }>;
};
type LinkRow = { id: string; token: string; application_count: number; expires_at: string; asking_rent: number | string | null; property: Rel<PropRel> };

const AFF_TONE = { comfortable: "text-mint-700", borderline: "text-amber-700", risky: "text-danger-600", unknown: "text-text-muted" } as const;

function q(v: string | string[] | undefined) {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

/**
 * Kiracı başvuruları merkezi (SP5): açık başvuru bağlantıları, aday listesi (durum + portföy süzgeci, gerçek sayfalama),
 * yan yana karşılaştırma seçimi. Her sayı tıklanır ve süzülmüş listeye gider.
 */
export default async function BasvurularPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ perms, tenantId }, sp] = await Promise.all([requireModulePage("rentals", "/app/kiralama"), searchParams]);
  const canEdit = perms.rentals?.includes("edit") ?? false;
  const durumRaw = q(sp.durum);
  const durum: RentalApplicationStatus | "acik" | "" = durumRaw === "acik" ? "acik" : isApplicationStatus(durumRaw) ? durumRaw : "";
  const portfoy = UUID_RE.test(q(sp.portfoy)) ? q(sp.portfoy) : "";
  const page = parsePage(sp.sayfa);
  const offset = (page - 1) * PAGE_SIZE;
  const params = { durum: durum || undefined, portfoy: portfoy || undefined };

  const supabase = await createClient();
  let list = supabase
    .from("rental_applications")
    .select(
      "id, full_name, occupation, monthly_income, guarantor_name, file_count, status, created_at, property:properties!rental_applications_property_id_fkey(id, title, property_code, list_price), link:rental_application_links!rental_applications_link_id_fkey(asking_rent)",
      { count: "exact" },
    )
    .eq("tenant_id", tenantId ?? "")
    .order("created_at", { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);
  if (durum === "acik") list = list.in("status", [...OPEN_RENTAL_APPLICATION_STATUSES]);
  else if (durum) list = list.eq("status", durum);
  if (portfoy) list = list.eq("property_id", portfoy);

  let statusQ = supabase.from("rental_applications").select("status").eq("tenant_id", tenantId ?? "").limit(1000);
  if (portfoy) statusQ = statusQ.eq("property_id", portfoy);

  const [listRes, statusRes, linksRes, propsRes] = await Promise.all([
    list,
    statusQ,
    supabase
      .from("rental_application_links")
      .select("id, token, application_count, expires_at, asking_rent, property:properties!rental_application_links_property_id_fkey(id, title, property_code, list_price)")
      .eq("tenant_id", tenantId ?? "")
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(50),
    canEdit
      ? supabase
          .from("properties")
          .select("id, title, property_code")
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(20)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const missing = [listRes.error, linksRes.error].some((e) => e && (e.code === "42P01" || e.code === "PGRST205"));
  if (missing) {
    return (
      <div className="space-y-6">
        <BackLink />
        <PageHeader title="Kiracı başvuruları" eyebrow="Mülk yönetimi" />
        <Alert tone="warning">Kiracı başvurusu kurulum bekliyor: veritabanı güncellemesi henüz uygulanmamış.</Alert>
      </div>
    );
  }
  assertQueryBatchSucceeded([listRes, statusRes, linksRes, propsRes], ["basvurular", "durumlar", "baglantilar", "portfoyler"], "kiralama-basvurular");

  const rows = (listRes.data ?? []) as unknown as AppRow[];
  const total = listRes.count ?? rows.length;
  const counts: Record<string, number> = {};
  for (const r of (statusRes.data ?? []) as { status: string }[]) counts[r.status] = (counts[r.status] ?? 0) + 1;
  const openCount = OPEN_RENTAL_APPLICATION_STATUSES.reduce((s, k) => s + (counts[k] ?? 0), 0);
  const allCount = Object.values(counts).reduce((a, b) => a + b, 0);
  const links = (linksRes.data ?? []) as unknown as LinkRow[];
  const base = getBaseUrl();
  const propsForPanel = ((propsRes.data ?? []) as { id: string; title: string | null; property_code: string | null }[]).map((p) => ({
    id: p.id,
    label: p.title ?? p.property_code ?? "Portföy",
    hint: p.title ? (p.property_code ?? undefined) : undefined,
  }));
  const filteredProperty = portfoy ? (one(rows[0]?.property ?? null) ?? one(links.find((l) => one(l.property)?.id === portfoy)?.property ?? null)) : null;
  const href = (p: { durum?: string; portfoy?: string }) => {
    const u = new URLSearchParams();
    if (p.durum) u.set("durum", p.durum);
    if (p.portfoy) u.set("portfoy", p.portfoy);
    const s = u.toString();
    return s ? `${PATH}?${s}` : PATH;
  };
  const w = pageWindow(page, total, PAGE_SIZE, rows.length);

  return (
    <div className="space-y-6">
      <BackLink />
      <PageHeader
        title="Kiracı başvuruları"
        eyebrow="Mülk yönetimi"
        description="Kiralık ilanlarınıza tek bağlantıyla başvuru toplayın; adayları gelir, kefil ve evrakla yan yana karşılaştırıp malike önerin."
        actions={canEdit ? <NewLinkTrigger /> : null}
      />
      {canEdit ? <NewLinkPanel properties={propsForPanel} /> : null}

      <StatRow
        label="Başvuru özeti"
        items={[
          { label: "Değerlendirilen", value: openCount, href: href({ durum: "acik", portfoy }), icon: <Inbox className="h-4 w-4" />, hint: "yeni + kısa liste + malikte" },
          { label: "Yeni", value: counts.new ?? 0, href: href({ durum: "new", portfoy }), icon: <Users className="h-4 w-4" />, attention: true },
          { label: "Malik onayında", value: counts.owner_review ?? 0, href: href({ durum: "owner_review", portfoy }), icon: <ShieldCheck className="h-4 w-4" /> },
          { label: "Onaylanan", value: counts.approved ?? 0, href: href({ durum: "approved", portfoy }), icon: <CheckCircle2 className="h-4 w-4" /> },
        ]}
      />

      <section aria-labelledby="links-title" className="rounded-[var(--radius-panel)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)] md:p-5">
        <h2 id="links-title" className="flex items-center gap-2 font-display text-sm font-bold text-ink-950">
          <Link2 className="h-4 w-4 text-brand-600" aria-hidden="true" /> Açık başvuru bağlantıları
          <span className="numeric text-text-muted">({links.length})</span>
        </h2>
        {links.length === 0 ? (
          <p className="mt-2 text-sm text-text-muted">
            Henüz açık bağlantı yok. {canEdit ? "“Başvuru bağlantısı” ile kiralık bir portföy için bağlantı oluşturup ilanda paylaşın." : ""}
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {links.map((l) => {
              const p = one(l.property);
              const label = p?.title ?? p?.property_code ?? "Portföy";
              return (
                <li key={l.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <Link href={href({ portfoy: p?.id })} className="focus-ring block truncate rounded-[var(--radius-control)] text-sm font-semibold text-ink-950 hover:underline">
                      {label}
                    </Link>
                    <p className="text-xs text-text-muted">
                      <span className="numeric">{l.application_count}</span> başvuru · son gün {formatDateTr(l.expires_at, { day: "2-digit", month: "short" })}
                      {l.asking_rent ? ` · ${formatTry(Number(l.asking_rent))}` : ""}
                    </p>
                  </div>
                  {canEdit && p ? <LinkActions linkId={l.id} propertyId={p.id} url={`${base}${applicationLinkPath(l.token)}`} label={label} /> : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="space-y-3">
        <CategoryChips
          label="Başvuru durumu"
          paramName="durum"
          pathname={PATH}
          params={params}
          active={durum}
          total={allCount}
          counts={{ ...counts, acik: openCount }}
          options={[{ value: "acik", label: "Değerlendirilen" }, ...RENTAL_APPLICATION_STATUSES.map((s) => ({ value: s, label: APPLICATION_STATUS_LABELS[s] }))]}
        />
        {portfoy ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <FilterChip href={href({ durum: durum || undefined })} active>
              Portföy: {filteredProperty?.title ?? filteredProperty?.property_code ?? "seçili"} ✕
            </FilterChip>
          </div>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <EmptyStateV3
          icon={ListChecks}
          title={durum || portfoy ? "Bu süzgeçte başvuru yok." : "Henüz kiracı başvurusu yok."}
          description={
            durum || portfoy
              ? "Süzgeci kaldırarak tüm başvuruları görebilirsiniz."
              : "Kiralık portföy için başvuru bağlantısı oluşturun ve ilanda paylaşın; adaylar telefondan başvurur, kefil ve evrak ekler."
          }
        />
      ) : (
        <CompareProvider>
          <ul className="grid gap-3 md:grid-cols-2" aria-label="Kiracı başvuruları">
            {rows.map((r) => {
              const p = one(r.property);
              const l = one(r.link);
              const rent = l?.asking_rent != null ? Number(l.asking_rent) : p?.list_price != null ? Number(p.list_price) : null;
              const ratio = rentToIncomeRatio(rent, r.monthly_income != null ? Number(r.monthly_income) : null);
              const aff = affordability(ratio);
              const st = isApplicationStatus(r.status) ? r.status : "new";
              return (
                <li key={r.id} className="flex items-start gap-1 rounded-[var(--radius-card)] border border-line bg-surface p-3 shadow-[var(--shadow-xs)]">
                  <CompareCheckbox id={r.id} name={r.full_name} />
                  <Link href={`${PATH}/${r.id}`} className="focus-ring min-w-0 flex-1 rounded-[var(--radius-control)] py-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-semibold text-ink-950">{r.full_name}</span>
                      <Badge variant={APPLICATION_STATUS_TONES[st]} size="sm">{APPLICATION_STATUS_LABELS[st]}</Badge>
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-text-muted">
                      {p?.title ?? p?.property_code ?? "Portföy"} · {formatDateTr(r.created_at, { day: "2-digit", month: "short" })}
                    </span>
                    <span className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                      <span className="text-text-muted">{r.occupation ?? "Meslek belirtilmedi"}</span>
                      <span className="numeric font-semibold text-ink-950">{r.monthly_income != null ? formatTry(Number(r.monthly_income)) : "Gelir yok"}</span>
                      <span className={`font-semibold ${AFF_TONE[aff]}`}>{ratio != null ? `Kira/gelir ${ratioLabel(ratio)} · ${AFFORDABILITY_LABELS[aff]}` : ""}</span>
                    </span>
                    <span className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
                      <span className={r.guarantor_name ? "text-mint-700" : "text-amber-700"}>{r.guarantor_name ? "Kefilli" : "Kefil yok"}</span>
                      <span className="inline-flex items-center gap-1"><FileText className="h-3.5 w-3.5" aria-hidden="true" />{r.file_count > 0 ? `${r.file_count} belge` : "Belge yok"}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </CompareProvider>
      )}
      <ListPager pathname={PATH} params={params} window={w} total={total} />
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/app/kiralama" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-text-muted transition hover:text-brand-600">
      <ArrowLeft className="h-4 w-4" /> Mülk yönetimi
    </Link>
  );
}
