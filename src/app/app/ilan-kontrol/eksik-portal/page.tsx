import Link from "@/components/ui/smart-link";
import { Suspense } from "react";
import { FilterChip } from "@/components/ui/filter-chip";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonCard } from "@/components/ui/viz";
import { EmptyState } from "@/components/ui/empty-state";
import { TableFrame, Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { ButtonLink } from "@/components/ui/button";
import { effectiveCanAccessModule } from "@/lib/permissions-effective";
import { requireModulePage } from "@/lib/require-module-page";
import { formatTry } from "@/lib/format";
import { isTransferPortal, PORTAL_FORM_RULES, TRANSFER_PORTALS, type TransferPortal } from "@/lib/portal-transfer/rules";
import { CONTROL_BASE } from "@/components/listing-control/helpers";
import { ControlSubNav } from "@/components/listing-control/sub-nav";
import { ControlUnavailable } from "@/components/listing-control/ui-parts";
import { getDb, loadPropertyBriefs } from "@/components/listing-control/readers";
import { loadPortalGaps } from "@/components/listing-control/portal-gap-readers";
import { getActivePortals } from "@/lib/portals/membership";
import { PORTAL_MEMBERSHIP_HREF } from "@/lib/portals/catalog";
import { withLocative } from "@/lib/tr-suffix";

export const metadata = { title: "Portalda olmayan portföyler" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const PAGE_SIZE = 50;

/**
 * EKSİK PORTAL listesi: yayındaki portföy, ofisin kullandığı portalda canlı ilan taşımıyor. İlan Kontrol ana ekranındaki
 * "Portal farkları" kartıyla AYNI kaynaktan (`portal-gap-readers`) beslenir. Her satırda tek eylem: "Portala aktar".
 * Portal çipleri ofisin ÜYELİKLERİYLE süzülür: üye olunan portal (ilanı olmasa da) seçilebilir; üye olunmayan portal soluk
 * durur ve "Üye değilsiniz, ekle" bağlantısı üyelik kartına götürür (aktarım önerilmez).
 */
export default async function EksikPortalPage({ searchParams }: { searchParams: SearchParams }) {
  const { perms, tenantId } = await requireModulePage("portals", "/app/ilan-kontrol");
  const [sp, active] = await Promise.all([searchParams, tenantId ? getActivePortals(tenantId) : Promise.resolve([...TRANSFER_PORTALS])]);
  const raw = Array.isArray(sp.portal) ? sp.portal[0] : sp.portal;
  const portal: TransferPortal = isTransferPortal(raw) ? raw : (active[0] ?? "sahibinden");
  const isMember = (active as readonly string[]).includes(portal);
  const sayfa = Math.max(1, Math.min(200, Number.parseInt(String(Array.isArray(sp.sayfa) ? sp.sayfa[0] : sp.sayfa ?? "1"), 10) || 1));
  return (
    <>
      <PageHeader
        eyebrow="İlan Kontrol"
        title={`${withLocative(PORTAL_FORM_RULES[portal].label)} olmayan portföyler`}
        description="Yayındaki portföy, ofisinizin kullandığı bu portalda canlı ilan taşımıyor. Satırdan “Portala aktar” ile eklentiyle forma doldurabilirsiniz."
        breadcrumbs={[{ label: "İlan Kontrol", href: CONTROL_BASE }, { label: "Eksik portal" }]}
      />
      <ControlSubNav active="liste" closures={effectiveCanAccessModule(perms, "leak")} />
      <nav aria-label="Portal" className="mb-4 flex flex-wrap gap-1.5">
        {TRANSFER_PORTALS.map((p) =>
          (active as readonly string[]).includes(p) ? (
            <FilterChip key={p} href={`${CONTROL_BASE}/eksik-portal?portal=${p}`} active={p === portal}>
              {PORTAL_FORM_RULES[p].label}
            </FilterChip>
          ) : (
            <span key={p} className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-line px-3 py-1 text-xs text-text-faint opacity-70">
              {PORTAL_FORM_RULES[p].label}
              <Link href={PORTAL_MEMBERSHIP_HREF} className="font-semibold text-accent-text hover:underline">Üye değilsiniz, ekle</Link>
            </span>
          ),
        )}
      </nav>
      {isMember ? (
        <Suspense fallback={<SkeletonCard height={420} label="Liste yükleniyor" />}>
          <Body portal={portal} sayfa={sayfa} tenantId={tenantId} />
        </Suspense>
      ) : (
        <EmptyState
          variant="panel"
          title={`${PORTAL_FORM_RULES[portal].label} üyeliğiniz kayıtlı değil`}
          description="Bu portala üye değilseniz aktarım önerilmez. Üyeyseniz Portal üyelikleri kartında işaretleyin; liste burada görünür."
          secondary={{ href: PORTAL_MEMBERSHIP_HREF, label: "Üye değilsiniz, ekle" }}
        />
      )}
    </>
  );
}

async function Body({ portal, sayfa, tenantId }: { portal: TransferPortal; sayfa: number; tenantId: string | null }) {
  const db = await getDb();
  const res = await loadPortalGaps(db, tenantId);
  if (!res.available) return <ControlUnavailable />;
  const gap = res.gaps.find((g) => g.portal === portal);
  if (!gap) {
    return (
      <EmptyState
        variant="panel"
        title={`${PORTAL_FORM_RULES[portal].label} için eksik portföy yok`}
        description="Yayındaki bütün portföyler bu portalda görünüyor ya da yayında portföy yok."
        secondary={{ href: CONTROL_BASE, label: "Genel görünüme dön" }}
      />
    );
  }
  const ids = gap.missing.slice((sayfa - 1) * PAGE_SIZE, sayfa * PAGE_SIZE);
  const briefs = await loadPropertyBriefs(db, ids);
  const hasNext = gap.missing.length > sayfa * PAGE_SIZE;
  return (
    <div className="space-y-3">
      <p className="text-sm text-text-muted">
        <span className="font-semibold tabular-nums text-text">{gap.missing.length}</span> portföy {withLocative(PORTAL_FORM_RULES[portal].label)} yok ({gap.used} portföyünüz bu portalda yayında).
      </p>
      <TableFrame stack minWidth={640}>
        <Table>
          <caption className="sr-only">{withLocative(PORTAL_FORM_RULES[portal].label)} olmayan portföyler</caption>
          <THead>
            <TR>
              <TH>Portföy</TH>
              <TH align="right">Fiyat</TH>
              <TH align="right">İşlem</TH>
            </TR>
          </THead>
          <TBody>
            {ids.map((id) => {
              const b = briefs.get(id);
              return (
                <TR key={id}>
                  <TD primary>
                    <Link href={`/app/portfoyler/${id}?sekme=portallar`} className="focus-ring rounded font-medium text-accent-text hover:underline">
                      <span className="font-mono text-xs text-text-muted">{b?.code ?? "-"}</span> {b?.title ?? "Portföy"}
                    </Link>
                  </TD>
                  <TD label="Fiyat" align="right">{b?.price != null ? formatTry(b.price) : "-"}</TD>
                  <TD label="İşlem" align="right">
                    <ButtonLink href={`/app/portfoyler/${id}?sekme=portallar#portallar`} size="sm" variant="outline">Portala aktar</ButtonLink>
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </TableFrame>
      <div className="flex justify-between gap-2">
        {sayfa > 1 ? (
          <Link href={`${CONTROL_BASE}/eksik-portal?portal=${portal}&sayfa=${sayfa - 1}`} className="focus-ring inline-flex min-h-10 items-center rounded-[var(--radius-control)] border border-line bg-surface px-4 text-sm font-semibold hover:border-brand-400 touch:min-h-11">
            Önceki
          </Link>
        ) : (
          <span />
        )}
        {hasNext ? (
          <Link href={`${CONTROL_BASE}/eksik-portal?portal=${portal}&sayfa=${sayfa + 1}`} className="focus-ring inline-flex min-h-10 items-center rounded-[var(--radius-control)] border border-line bg-surface px-4 text-sm font-semibold hover:border-brand-400 touch:min-h-11">
            Sonraki {PAGE_SIZE} portföy
          </Link>
        ) : null}
      </div>
    </div>
  );
}
