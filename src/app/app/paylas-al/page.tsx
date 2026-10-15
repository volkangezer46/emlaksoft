import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { PageHeader } from "@/components/ui/page-header";
import { sanitizeWatermarkSettings } from "@/lib/watermark";
import { offlineScopeFingerprint } from "@/lib/pwa/offline-scope";
import { OfflineNotesInbox } from "@/components/app/offline-notes-inbox";
import { ShareIntake } from "./share-intake";

export const metadata = { title: "Paylaşılan içerik" };

type Sp = { k?: string; hata?: string };

/** Paylaşım anahtarı: `<zaman>-<uuid>` (service worker üretir). Başka biçim okunmaz. */
const SHARE_KEY_RE = /^\d{10,16}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Telefonun "Paylaş" menüsünden EmlakSoft'a gönderilen fotoğraf / metin / kişi kartı (MP8 / GA-12) ve çevrimdışı
 * alınan notlar (MP9) burada işlenir. Paylaşılan dosyalar sunucuya bu sayfa açılırken GİTMEZ: service worker cihazda
 * geçici tutar, kullanıcı hedefi seçince (müşteri kaydı / portföy fotoğrafı) mevcut eylemlerle kaydedilir.
 * Desteklenmeyen tarayıcıda (iOS Safari paylaşım hedefini desteklemez) sayfa yalnız çevrimdışı notları gösterir.
 */
export default async function ShareTargetPage({ searchParams }: { searchParams?: Promise<Sp> }) {
  const { perms, tenantId, userId } = await requireModulePage("dashboard");
  const sp = (await searchParams) ?? {};
  const shareKey = sp.k && SHARE_KEY_RE.test(sp.k) ? sp.k : null;
  const canCreateCustomer = (perms.customers ?? []).includes("create");
  const canEditProperty = (perms.properties ?? []).includes("edit");
  const canCreateProperty = (perms.properties ?? []).includes("create");

  const supabase = await createClient();
  const { data: brandRow } =
    canEditProperty && tenantId
      ? await supabase.from("tenants").select("name, logo_url, watermark_settings").eq("id", tenantId).maybeSingle()
      : { data: null };
  const brand = brandRow as { name: string | null; logo_url: string | null; watermark_settings: unknown } | null;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <PageHeader title="Paylaşılan içerik" description="Telefonunuzdan paylaştığınız fotoğraf, metin ya da kişiyi kaydedin." />
      <OfflineNotesInbox scope={offlineScopeFingerprint(tenantId, userId)} canCreateCustomer={canCreateCustomer} />
      <ShareIntake
        shareKey={shareKey}
        failed={sp.hata === "1"}
        canCreateCustomer={canCreateCustomer}
        canEditProperty={canEditProperty}
        canCreateProperty={canCreateProperty}
        brand={{
          watermark: sanitizeWatermarkSettings(brand?.watermark_settings),
          officeName: brand?.name ?? "",
          logoUrl: brand?.logo_url ?? null,
        }}
      />
    </div>
  );
}
