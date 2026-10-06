import Link from "next/link";
import { Flag } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { Table, TableFrame, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requirePlatformModule } from "@/lib/platform";
import { getFeatureFlagStates } from "@/lib/feature-flags/server";

export const metadata = { title: "Özellik bayrakları" };

const SOURCE_LABEL = { setting: "Platform ayarı", platform: "Platform ayarı (kendi ekranı)", env: "Ortam değişkeni" } as const;

/**
 * Özellik bayrakları: dağınık açma/kapama bayraklarının TEK listesi (envanter `src/lib/feature-flags/registry.ts`,
 * okuyucu `isFeatureEnabled`). Her satır gerçek durumu, açıklamayı ve etkiyi gösterir; düzenleme bayrağın kendi
 * bölümündedir (her ayar tek yerde, geçmiş `settings_history`). Ortam değişkenleri buradan değiştirilemez.
 */
export default async function FeatureFlagsPage() {
  await requirePlatformModule("sistem");
  const states = await getFeatureFlagStates();
  const on = states.filter((s) => s.enabled).length;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        eyebrow="Ayarlar"
        icon={Flag}
        title="Özellik bayrakları"
        description={`${states.length} bayrak, ${on} tanesi şu an açık. Ayar bayrakları kendi bölümünde düzenlenir ve geçmişe yazılır; ortam değişkenleri Vercel'de değiştirilir.`}
      />
      <TableFrame minWidth={760}>
        <Table>
          <caption className="sr-only">Özellik bayrakları, durumları ve etkileri</caption>
          <THead>
            <TR>
              <TH>Bayrak</TH>
              <TH>Durum</TH>
              <TH>Etkisi</TH>
              <TH>Kaynak</TH>
              <TH align="right">Düzenleme</TH>
            </TR>
          </THead>
          <TBody>
            {states.map(({ def, raw, enabled }) => (
              <TR key={def.key}>
                <TD>
                  <span className="block font-semibold text-ink-950">{def.label}</span>
                  <span className="block text-xs text-text-muted">{def.description}</span>
                </TD>
                <TD>
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-bold ${
                      enabled ? "bg-mint-500/15 text-mint-700" : "bg-ink-950/6 text-text-muted"
                    }`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${enabled ? "bg-mint-500" : "bg-text-faint"}`} aria-hidden />
                    {enabled ? "Açık" : raw && def.requires ? "Açık ama bağlı bayrak kapalı" : "Kapalı"}
                  </span>
                </TD>
                <TD className="max-w-xs text-xs text-text-muted">{def.impact}</TD>
                <TD className="text-xs text-text-muted">
                  {SOURCE_LABEL[def.source]}
                  {def.envVar ? <code className="mt-0.5 block text-text-faint">{def.envVar}</code> : null}
                </TD>
                <TD align="right">
                  {def.editHref ? (
                    <Link href={def.editHref} className="text-xs font-semibold text-brand-600 hover:underline">
                      Düzenle →
                    </Link>
                  ) : (
                    <span className="text-xs text-text-faint">Vercel ortamında</span>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </TableFrame>
    </div>
  );
}
