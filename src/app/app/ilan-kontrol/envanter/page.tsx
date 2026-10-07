import Link from "@/components/ui/smart-link";
import { Suspense } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonCard } from "@/components/ui/viz";
import { TableFrame, Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { effectiveCanAccessModule, effectiveHasPermission } from "@/lib/permissions-effective";
import { requireModulePage } from "@/lib/require-module-page";
import { formatDateTimeTr } from "@/lib/format";
import { CONTROL_BASE, kpiHref } from "@/components/listing-control/helpers";
import { ControlSubNav } from "@/components/listing-control/sub-nav";
import { Panel } from "@/components/listing-control/ui-parts";
import { InventoryImportForm } from "@/components/listing-control/inventory-import-form";
import { listRecentImports, type ImportHistoryRow } from "@/components/listing-control/ops-readers";
import { getDb, loadProfileNames } from "@/components/listing-control/readers";

export const metadata = { title: "Portal listesiyle karşılaştır" };

const MANAGER_ROLES = new Set(["owner", "gm", "branch_manager"]);
const SOURCE_LABEL: Record<ImportHistoryRow["source"], string> = { csv: "Dosya", paste: "Yapıştırma", extension: "Eklenti" };

/**
 * Portal ENVANTERİ karşılaştırma: danışman ya da yönetici portal hesabındaki ilan listesini yükler; CRM'deki canlı
 * ilanlarla karşılaştırılır (kaldırılmış / kayıtsız / hiç yayınlanmamış / ilan no hatalı / kontrol edilemedi / farklı
 * danışman / fiyat farkı). Listede olup CRM'de olmayan ilanlar eşleşme kuyruğuna düşer.
 */
export default async function EnvanterPage() {
  const { perms, role } = await requireModulePage("portals", "/app/ilan-kontrol");
  const canEdit = effectiveHasPermission(perms, "portals", "edit");
  return (
    <>
      <PageHeader
        eyebrow="İlan Kontrol"
        title="Portal listesiyle karşılaştır"
        description="Portal hesabınızdaki ilan listesini yükleyin; CRM'de kaydı olmayan, portaldan kalkmış ya da fiyatı farklı ilanlar tek tek çıksın."
        breadcrumbs={[{ label: "İlan Kontrol", href: CONTROL_BASE }, { label: "Portal listesi" }]}
      />
      <ControlSubNav active="envanter" closures={effectiveCanAccessModule(perms, "leak")} />
      <div className="space-y-6">
        <Panel title="Listeyi yükle" description="Dosya, yapıştırma ya da tarayıcı eklentisiyle portal mağaza sayfasından okuma.">
          {canEdit ? (
            <InventoryImportForm canOffice={MANAGER_ROLES.has(role ?? "")} />
          ) : (
            <p className="text-sm text-text-muted">Portal listesi yüklemek için portal düzenleme yetkisi gerekir.</p>
          )}
        </Panel>
        <Suspense fallback={<SkeletonCard height={220} label="Geçmiş karşılaştırmalar yükleniyor" />}>
          <History />
        </Suspense>
      </div>
    </>
  );
}

async function History() {
  const db = await getDb();
  const res = await listRecentImports(db, 10);
  if (!res.available) {
    return (
      <Panel title="Geçmiş karşılaştırmalar">
        <p className="text-sm text-text-muted">Envanter karşılaştırma kaydı bu ofiste henüz etkin değil (sistem güncellemesi bekleniyor).</p>
      </Panel>
    );
  }
  if (res.rows.length === 0) {
    return (
      <Panel title="Geçmiş karşılaştırmalar">
        <p className="text-sm text-text-muted">Henüz karşılaştırma yapılmadı. İlk listeyi yüklediğinizde sonuçlar burada saklanır.</p>
      </Panel>
    );
  }
  const names = await loadProfileNames(db, res.rows.map((r) => r.actor_id));
  const link = (n: number, href: string, label: string) =>
    n > 0 ? (
      <Link href={href} aria-label={label} className="focus-ring rounded font-semibold tabular-nums text-accent-text hover:underline">
        {n}
      </Link>
    ) : (
      <span className="tabular-nums text-text-muted">0</span>
    );
  return (
    <Panel title="Geçmiş karşılaştırmalar" description="Her sayı ilgili listeye gider. Kayıp, ancak liste tam işaretlendiyse ve doğrulama ikinci kez teyit ettiyse kesinleşir.">
      <TableFrame minWidth={860}>
        <Table>
          <caption className="sr-only">Son portal listesi karşılaştırmaları</caption>
          <THead>
            <TR>
              <TH>Tarih</TH>
              <TH>Portal</TH>
              <TH>Kaynak</TH>
              <TH align="right">Liste</TH>
              <TH align="right">Eşleşen</TH>
              <TH align="right">Kaldırılmış</TH>
              <TH align="right">Kayıtsız</TH>
              <TH align="right">Yayınlanmamış</TH>
              <TH align="right">Fiyat farkı</TH>
              <TH align="right">Farklı danışman</TH>
            </TR>
          </THead>
          <TBody>
            {res.rows.map((r) => (
              <TR key={r.id}>
                <TD>
                  {formatDateTimeTr(r.created_at)}
                  <div className="text-xs text-text-muted">
                    {r.actor_id ? (names.get(r.actor_id) ?? "-") : "-"} · {r.scope === "office" ? "ofis geneli" : "kendi portföyleri"}
                  </div>
                </TD>
                <TD className="capitalize">{r.portal}</TD>
                <TD>
                  {SOURCE_LABEL[r.source]}
                  <div className="text-xs text-text-muted">{r.complete ? "tam liste" : "kısmi liste"}</div>
                </TD>
                <TD align="right"><span className="tabular-nums">{r.total_rows}</span></TD>
                <TD align="right">{link(r.matched, kpiHref("in_portals"), "Yayındaki portföyler")}</TD>
                <TD align="right">{link(r.removed, `${CONTROL_BASE}/anomaliler?tur=portal_missing`, "Kayıp uyarıları")}</TD>
                <TD align="right">{link(r.unregistered, `${CONTROL_BASE}/eslesme`, "Eşleşme kuyruğu")}</TD>
                <TD align="right">{link(r.never_published, kpiHref("awaiting_publish"), "Yayın bekleyenler")}</TD>
                <TD align="right">{link(r.price_diff, kpiHref("price_mismatch"), "Fiyat uyuşmazlıkları")}</TD>
                <TD align="right">{link(r.other_advisor, `${CONTROL_BASE}/anomaliler?tur=advisor_mismatch`, "Danışman uyuşmazlıkları")}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </TableFrame>
    </Panel>
  );
}
