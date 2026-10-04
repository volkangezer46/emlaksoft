import { ArrowRight, PowerOff } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { getModuleDef, isFeatureKey } from "@/lib/modules/registry";
import { canManageModules } from "@/lib/modules/permissions";
import { requireModulePage } from "@/lib/require-module-page";

export const metadata = { title: "Modül kapalı" };

/**
 * Ofisin kapattığı bir modülün adresine gidildiğinde varılan sayfa (404 DEĞİL).
 * Veri silinmez; modül Ayarlar > Modüller'den yeniden açılabilir. Sahip ve genel müdür
 * "Modüllere git" düğmesini görür, diğer roller yöneticisine yönlendirilir.
 */
export default async function ModuleClosedPage({
  searchParams,
}: {
  searchParams: Promise<{ modul?: string }>;
}) {
  const { role } = await requireModulePage("dashboard");
  const { modul } = await searchParams;
  const def = isFeatureKey(modul) ? getModuleDef(modul) : null;
  const manager = canManageModules(role);

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader
        eyebrow="Modül kapalı"
        title={def ? `${def.label} kapalı` : "Bu modül kapalı"}
        description="Bu modül ofisiniz için kapatılmış. Ayarlar > Modüller'den açabilirsiniz."
        breadcrumbs={[{ label: "Ana ekran", href: "/app" }, { label: "Modül kapalı" }]}
      />

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-[var(--radius-control)] tone-info">
              <PowerOff className="h-4 w-4" aria-hidden />
            </span>
            <CardTitle>{def ? def.label : "Kapalı modül"}</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {def ? <p className="text-sm text-text-muted">{def.desc}</p> : null}
          <Alert tone="info" title="Verileriniz silinmedi" className="mt-4">
            Modül kapalıyken menüde, aramada ve ana ekranda görünmez; otomasyon ve bildirim üretmez. Yeniden açtığınızda
            kayıtlarınız olduğu gibi geri gelir.
          </Alert>
          <div className="mt-6 flex flex-wrap items-center gap-2">
            {manager ? (
              <ButtonLink href="/app/ayarlar/moduller" iconRight={ArrowRight}>
                Modüllere git
              </ButtonLink>
            ) : (
              <p className="text-sm text-text-muted">Modülü açmak için ofis yöneticinize (ofis sahibi veya genel müdür) söyleyin.</p>
            )}
            <ButtonLink href="/app" variant="secondary">
              Ana ekrana dön
            </ButtonLink>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
