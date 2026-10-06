import { Scale } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { RegistrySettings } from "@/components/settings/registry-settings";
import { Table, TableFrame, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { allLegalConstants } from "@/lib/legal-constants";
import { requirePlatformModule } from "@/lib/platform";

export const metadata = { title: "Yasal metinler ve mevzuat sabitleri" };

/**
 * Yasal metinler (düzenlenebilir, ayar defteri + settings_history) ve mevzuat sabitleri envanteri.
 * Mevzuat sabitleri (`src/lib/legal-constants`) ofis hesaplayıcılarında istemci tarafında eşzamanlı okunur; yönetimden
 * değer geçersiz kılmak bu hesaplayıcılara sunucu değeri taşımayı gerektirir (ayrı iş). Bu yüzden burada SALT OKUNUR
 * listelenir: değer, kaynak ve doğrulama durumu. Hukuki/mali danışmanlık değildir; metin sorumluluğu ofis/şirket sahibindedir.
 */
export default async function LegalSettingsPage() {
  const staff = await requirePlatformModule("sistem");
  const constants = allLegalConstants();
  const unverified = constants.filter((c) => !c.verified).length;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        eyebrow="Ayarlar"
        icon={Scale}
        title="Yasal metinler ve mevzuat sabitleri"
        description="Başvuru formu onay metinleri buradan düzenlenir; her değişiklik gerekçesiyle geçmişe yazılır ve rıza kanıtının sürümüne yansır."
      />

      <RegistrySettings
        id="metinler"
        title="Başvuru formu metinleri"
        description="Ofislerin herkese açık başvuru formunda gösterilir. Varsayılan metin koddaki değerdir; Varsayılana dön ile geri alınır."
        keys={["legal.lead_consent_text", "legal.lead_notice_text", "legal.lead_marketing_text"]}
        canEdit={staff.role === "super_admin"}
      />

      <section aria-labelledby="sabitler-baslik" className="space-y-3">
        <div>
          <h2 id="sabitler-baslik" className="text-base font-semibold text-ink-950">
            Mevzuat sabitleri (salt okunur)
          </h2>
          <p className="text-xs text-text-muted">
            {constants.length} sabit, {unverified} tanesi resmî kaynaktan doğrulanmadı. Değerler kodda tek kaynaktadır (src/lib/legal-constants);
            değişiklik geliştirici tarafından yapılır ve envanter belgesine (docs/MEVZUAT_SABITLERI.md) işlenir.
          </p>
        </div>
        <TableFrame minWidth={720}>
          <Table>
            <caption className="sr-only">Mevzuat sabitleri, değerleri, kaynakları ve doğrulama durumu</caption>
            <THead>
              <TR>
                <TH>Sabit</TH>
                <TH align="right">Değer</TH>
                <TH>Kaynak</TH>
                <TH>Durum</TH>
              </TR>
            </THead>
            <TBody>
              {constants.map((c) => (
                <TR key={c.key}>
                  <TD>
                    <span className="block font-semibold text-ink-950">{c.label}</span>
                    {c.note ? <span className="block text-xs text-text-muted">{c.note}</span> : null}
                  </TD>
                  <TD align="right" className="whitespace-nowrap font-semibold text-ink-950">
                    {c.valueText}
                  </TD>
                  <TD className="max-w-sm text-xs text-text-muted">{c.source}</TD>
                  <TD>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${c.verified ? "bg-mint-500/15 text-mint-700" : "bg-amber-500/12 text-amber-800"}`}>
                      {c.verified ? `Doğrulandı${c.verifiedAt ? ` · ${c.verifiedAt}` : ""}` : "Doğrulanmadı"}
                    </span>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableFrame>
      </section>
    </div>
  );
}
