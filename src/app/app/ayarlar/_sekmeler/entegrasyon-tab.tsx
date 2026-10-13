import { Suspense } from "react";
import { Plug, Store } from "lucide-react";
import { SkeletonCard } from "@/components/ui/viz";
import { createClient } from "@/lib/supabase/server";
import { isNetgsmConfigured } from "@/lib/messaging/netgsm";
import { platformMessagingFallbackAllowed } from "@/lib/messaging/tenant-providers";
import { IntegrationsForm } from "../integrations-form";
import { ReadOnlyGate } from "../read-only-gate";
import { PortalMembershipsSection } from "./portal-memberships-section";

/** Sekme: ofise özel Netgsm SMS + WhatsApp Cloud API. Şifre / erişim anahtarı istemciye ASLA gitmez (yalnız var/yok). */
export async function EntegrasyonTab({ canEdit }: { canEdit: boolean }) {
  const supabase = await createClient();
  const [{ data: netgsmRow }, { data: whatsappRow }, netgsmPlatformConfigured] = await Promise.all([
    // Tablo henüz oluşmadıysa error döner, data null kalır — form boş başlar
    supabase.from("tenant_integrations").select("credentials, external_account_id").eq("provider", "netgsm").limit(1).maybeSingle(),
    supabase
      .from("tenant_integrations")
      .select("credentials, external_account_id, whatsapp_business_account_id, graph_api_version, connection_status")
      .eq("provider", "whatsapp")
      .limit(1)
      .maybeSingle(),
    isNetgsmConfigured(),
  ]);
  const netgsmCreds = (netgsmRow?.credentials ?? null) as { usercode?: string; password?: string; msgheader?: string } | null;
  const netgsm = netgsmCreds && (netgsmCreds.usercode || netgsmCreds.msgheader)
    ? {
        usercode: netgsmCreds.usercode ?? "",
        msgheader: netgsmCreds.msgheader ?? "",
        inboundReceiver: String(netgsmRow?.external_account_id ?? ""),
        hasPassword: Boolean(netgsmCreds.password),
      }
    : null;
  const whatsappCreds = (whatsappRow?.credentials ?? null) as { configured?: boolean } | null;
  const whatsapp = whatsappRow
    ? {
        phoneNumberId: String(whatsappRow.external_account_id ?? ""),
        wabaId: String(whatsappRow.whatsapp_business_account_id ?? ""),
        graphVersion: String(whatsappRow.graph_api_version ?? ""),
        hasAccessToken: whatsappCreds?.configured === true,
        status: String(whatsappRow.connection_status ?? "configured"),
      }
    : null;
  return (
    <>
      <section id="entegrasyonlar" className="dashboard-panel scroll-mt-24 rounded-[var(--radius-panel)] border border-line bg-surface p-4 md:p-6">
        <div className="flex items-center gap-3 border-b border-line pb-4">
          <span className="grid h-11 w-11 place-items-center rounded-[var(--radius-card)] bg-cyan-400/12 text-cyan-500"><Plug className="h-5 w-5" /></span>
          <div>
            <h2 className="font-display font-bold text-ink-950">Entegrasyonlar</h2>
            <p className="text-xs text-text-muted">Ofise özel Netgsm SMS ve WhatsApp Cloud API bağlantıları</p>
          </div>
        </div>
        <div className="mt-5">
          <ReadOnlyGate canEdit={canEdit}>
            <IntegrationsForm netgsm={netgsm} platformConfigured={netgsmPlatformConfigured && platformMessagingFallbackAllowed()} whatsapp={whatsapp} />
          </ReadOnlyGate>
        </div>
      </section>
      {/* Portal üyelikleri (EP1): eklenti, gece işleri ve portal ekranlarının tek kaynağı. Düzenleme owner/gm. */}
      <section id="portal-uyelikleri" className="dashboard-panel mt-6 scroll-mt-24 rounded-[var(--radius-panel)] border border-line bg-surface p-4 md:p-6">
        <div className="flex items-center gap-3 border-b border-line pb-4">
          <span className="grid h-11 w-11 place-items-center rounded-[var(--radius-card)] bg-brand-600/10 text-brand-600"><Store className="h-5 w-5" /></span>
          <div>
            <h2 className="font-display font-bold text-ink-950">Portal üyelikleri</h2>
            <p className="text-xs text-text-muted">Hangi portallarda ilan veriyorsunuz? Eklenti yalnız üye olduğunuz ve kontrolü açık portallara istek atar.</p>
          </div>
        </div>
        <div className="mt-5">
          <Suspense fallback={<SkeletonCard height={260} label="Portal üyelikleri yükleniyor" />}>
            <PortalMembershipsSection />
          </Suspense>
        </div>
      </section>
    </>
  );
}
