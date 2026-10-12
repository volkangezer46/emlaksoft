import { redirect } from "next/navigation";
import { requireModulePage } from "@/lib/require-module-page";
import { effectiveCanAccessModule } from "@/lib/permissions-effective";
import { PageHeader } from "@/components/ui/page-header";
import { SonucView } from "../../anketler/sonuc-view";

/**
 * Memnuniyet (NPS), Anketler merkezine taşındı (/app/anketler?sekme=sonuc); eski yol oraya yönlenir.
 * Anketler modülüne izni olmayan (yalnız raporlar yetkisi olan) kullanıcı aynı birleşik görünümü burada görmeye devam eder.
 */
export default async function SatisfactionReportRedirect() {
  const ctx = await requireModulePage("reports", "/app/raporlar");
  if (effectiveCanAccessModule(ctx.perms, "surveys")) redirect("/app/anketler?sekme=sonuc");
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Rapor merkezi · Memnuniyet" title="Müşteri memnuniyeti (NPS)" />
      <SonucView perms={ctx.perms} />
    </div>
  );
}
