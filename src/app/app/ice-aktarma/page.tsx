import Link from "@/components/ui/smart-link";
import { headers } from "next/headers";
import { ArrowLeft } from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { effectiveHasPermission } from "@/lib/permissions-effective";
import { createClient } from "@/lib/supabase/server";
import { loadAssignableAdvisors } from "@/lib/team/assignable-roles";
import type { ImportTarget } from "@/lib/import-rows";
import { importBackLabel, parseImportTarget, resolveImportBack } from "@/lib/import-start";
import { ImportWizard } from "./import-wizard";
import { IMPORT_ROW_LIMIT } from "./import-config";
import { listRecentImports } from "@/app/actions/import-rollback";
import { listPendingPhotoImports } from "@/app/actions/import-photos";

import { PageHeader } from "@/components/ui/page-header";
import { HelpTip } from "@/components/ui/help-tip";
export const metadata = { title: "İçe aktarma" };

const nf = new Intl.NumberFormat("tr-TR");
const ALL_IMPORT_TARGETS: readonly ImportTarget[] = ["customers", "properties", "demands", "tasks", "appointments", "expenses", "rentals"];

/**
 * İçe aktarma (sadeleştirme planı C28): ekranın üstünde "Ne taşıyorsunuz?" diye üç büyük hedef kartı (Müşteriler,
 * Portföyler, Talepler); görev, randevu, gider ve kira "Diğer türler" altında. KPI şeridi ve açıklama kartları yok:
 * nasıl çalıştığı ve güvenceler sayfanın sonunda tek katlanır bölümde. Hedef adresle seçilebilir (`?hedef=`); "Geri"
 * kullanıcının geldiği yere döner (`?geri=` > aynı sitedeki önceki sayfa > hedefin listesi). Sayfa kapısı "customers";
 * portföy ve diğer türler ayrıca server action'da kendi oluşturma izniyle korunur.
 */
export default async function ImportPage({ searchParams }: { searchParams: Promise<{ hedef?: string; geri?: string }> }) {
  const [{ perms, tenantId, userId, role }, sp, hdrs] = await Promise.all([requireModulePage("customers"), searchParams, headers()]);
  const canImportProperties = effectiveHasPermission(perms, "properties", "create");
  const canImportDemands = effectiveHasPermission(perms, "demands", "create");
  const canImportActivity = {
    tasks: effectiveHasPermission(perms, "tasks", "create"),
    appointments: effectiveHasPermission(perms, "appointments", "create"),
    expenses: effectiveHasPermission(perms, "expenses", "create"),
    // Kira aktarımı kiralama anlaşması + komisyon da açar (createRental ile aynı iki kapı).
    rentals: effectiveHasPermission(perms, "rentals", "create") && effectiveHasPermission(perms, "commissions", "create"),
  };
  const updateAllowed = {
    rentals: false,
    customers: effectiveHasPermission(perms, "customers", "edit"),
    properties: effectiveHasPermission(perms, "properties", "edit"),
    demands: false,
    tasks: false,
    appointments: false,
    expenses: false,
  };
  const rollbackAllowed = {
    // Kira aktarması geri alınamaz (atomik kira/anlaşma/komisyon zinciri; kira Kiralama ekranından sonlandırılır).
    rentals: false,
    customers: effectiveHasPermission(perms, "customers", "delete"),
    properties: effectiveHasPermission(perms, "properties", "delete"),
    demands: effectiveHasPermission(perms, "demands", "delete"),
    tasks: effectiveHasPermission(perms, "tasks", "delete"),
    appointments: effectiveHasPermission(perms, "appointments", "delete"),
    expenses: effectiveHasPermission(perms, "expenses", "delete"),
  };
  const supabase = await createClient();
  const initialTarget = parseImportTarget(sp.hedef, ALL_IMPORT_TARGETS);
  const back = resolveImportBack({ geri: sp.geri, referer: hdrs.get("referer"), host: hdrs.get("host"), target: initialTarget });

  const [teamRows, recentImports, pendingPhotos] = await Promise.all([
    // Atanabilir danışmanlar: yalnız aktif SATIŞ rolleri (B070; salt okunur / muhasebe / çağrı merkezi yok).
    tenantId ? loadAssignableAdvisors(supabase, tenantId, { userId, role }) : Promise.resolve([]),
    listRecentImports(),
    // Yarıda kalan fotoğraf indirmesi (portföy aktarımı): sihirbaz kaldığı yerden sürdürür.
    updateAllowed.properties ? listPendingPhotoImports() : Promise.resolve({ ids: [] as string[], urls: 0 }),
  ]);
  const team = teamRows.map((m) => ({ id: m.id, name: m.full_name }));
  const recent = recentImports.batches;

  return (
    <div className="space-y-4">
      <Link
        href={back}
        className="focus-ring inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-text-muted transition hover:text-brand-600"
        data-testid="ice-aktarma-geri"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden /> {importBackLabel(back)}
      </Link>

      <PageHeader title="İçe aktarma" description={<>Excel, CSV ya da telefon rehberinizdeki listeleri taşıyın. <HelpTip topic="ice-aktarma" /></>} />

      <ImportWizard
        initialTarget={initialTarget ?? undefined}
        canImportProperties={canImportProperties}
        canImportDemands={canImportDemands}
        canImportActivity={canImportActivity}
        updateAllowed={updateAllowed}
        rollbackAllowed={rollbackAllowed}
        team={team}
        recent={recent}
        pendingPhotos={pendingPhotos}
      />

      {/* Eskiden üstteki açıklama ve güvence kartları: tek katlanır bölüm (kademeli gösterim). */}
      <details className="rounded-[var(--radius-card)] border border-line bg-surface">
        <summary className="focus-ring flex min-h-11 cursor-pointer items-center px-4 text-sm font-semibold text-text">Nasıl çalışır?</summary>
        <ul className="list-disc space-y-1.5 border-t border-line px-8 py-3 text-sm text-text-muted">
          <li>Dosyanızı seçin, sütunları eşleyin, kaydetmeden önce önizleyin; sonuç özetinde hatalı satırları indirebilirsiniz.</li>
          <li>Telefonu ya da e-postası kayıtlı kişiler varsayılan olarak atlanır; isterseniz güncellenir ya da yeni kayıt açılır.</li>
          <li>Türkçe karakterli eski Excel dosyaları ve noktalı virgüllü CSV dosyaları sorunsuz okunur.</li>
          <li>Tek seferde {nf.format(IMPORT_ROW_LIMIT)} satıra kadar; daha büyük listeleri bölerek art arda yükleyin.</li>
          <li>Yaptığınız aktarmayı aşağıdaki &quot;Son içe aktarmalar&quot; listesinden tek tuşla geri alabilirsiniz.</li>
        </ul>
      </details>
    </div>
  );
}
