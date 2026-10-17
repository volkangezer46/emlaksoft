import { PageHeader } from "@/components/ui/page-header";
import { Alert } from "@/components/ui/alert";
import { requireModulePage } from "@/lib/require-module-page";
import { createClient } from "@/lib/supabase/server";
import { now } from "@/lib/clock";
import { loadSampleStatus } from "@/lib/sample-status";
import { REAL_USE_HREF, canSwitchToRealUse } from "@/lib/sample-data/real-use";
import { trialDaysLeft, trialLabel } from "@/lib/sample-data/trial";
import { RealUseDone, RealUseSwitch } from "./real-use-switch";
import { isDemoTenantSlug } from "@/lib/demo-tenant";
import { blockersFromDetail, type PurgeBlocker } from "@/lib/sample-data/purge-blockers";

import { IconChip } from "@/components/ui/icons";
import { Rocket } from "lucide-react";
export const metadata = { title: "Gerçek kullanıma geç" };

/**
 * Tek tuş "Gerçek kullanıma geç": örnek verileri sayılarla gösterir, onay alır, kalıcı siler.
 * Kabuk şeridi ve Ayarlar kartı buraya gelir. Sayılar oturum istemcisiyle (RLS) okunur; silme
 * `clearSampleData` (owner/gm kapısı + RPC) ile yapılır. Örnek veri yoksa başarı/sonraki adımlar ekranı.
 * Ön kontrol (F2, 20261027010200 `purge_sample_real_children`): örnek müşteri/portföye bağlı GERÇEK kayıt varsa onay
 * adımından ÖNCE listelenir ve geçiş kapalı kalır (purge da aynı kuralla ES409 ile durur). Fonksiyon yoksa (migration
 * bekliyor) ön kontrol atlanır; purge yine güvenlidir.
 */
export default async function RealUsePage() {
  const { tenantId, role } = await requireModulePage("settings", REAL_USE_HREF);
  const crumbs = [{ label: "Ayarlar", href: "/app/ayarlar" }, { label: "Gerçek kullanıma geç" }];
  if (!tenantId) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <PageHeader icon={<IconChip icon={Rocket} size="lg" />} title="Gerçek kullanıma geç" breadcrumbs={crumbs} />
        <Alert tone="info">Bu işlem bir ofis hesabı içinde yapılır.</Alert>
      </div>
    );
  }

  const supabase = await createClient();
  const { data: tenant } = await supabase.from("tenants").select("name, slug, sample_seeded_at, status, trial_ends_at").eq("id", tenantId).maybeSingle();
  const [status, blockers] = await Promise.all([
    loadSampleStatus(supabase, tenantId, tenant?.sample_seeded_at ?? null).catch(() => null),
    loadRealChildBlockers(supabase, tenantId),
  ]);
  const publicDemo = isDemoTenantSlug(tenant?.slug);
  const days = tenant?.status === "trial" ? trialDaysLeft(tenant.trial_ends_at, now()) : null;
  const trialText = trialLabel(days);
  const canClear = canSwitchToRealUse(role);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <PageHeader icon={<IconChip icon={Rocket} size="lg" />}
        eyebrow="Ayarlar"
        title="Gerçek kullanıma geç"
        description="Örnek (demo) kayıtları iki onayla tek seferde kaldır; ofisin yalnız kendi verinle çalışsın. Deneme süren ve paketin bu işlemden etkilenmez."
        breadcrumbs={crumbs}
        meta={trialText ? <span className="rounded-full bg-amber-400/15 px-2.5 py-1 text-xs font-bold text-amber-700">{trialText}</span> : null}
      />
      {publicDemo ? (
        <Alert tone="info">
          Bu, herkese açık tanıtım ofisidir: kayıtlar her gece kendiliğinden ilk haline döner ve gerçek kullanıma geçirilemez. Kendi ofisini açmak için
          kayıt ol; yeni ofisin aynı zengin demo verisiyle açılır.
        </Alert>
      ) : !status ? (
        <Alert tone="danger">Örnek veri durumu okunamadı. Sayfayı yenileyip tekrar deneyin.</Alert>
      ) : status.active && status.total > 0 ? (
        <RealUseSwitch rows={status.rows.map((r) => ({ label: r.label, count: r.count }))} total={status.total} canClear={canClear} officeName={tenant?.name ?? ""} blockers={blockers} />
      ) : (
        <RealUseDone deleted={null} />
      )}
      <p className="text-xs text-text-faint">
        Örnek kayıtlar listelerde &quot;Örnek veri&quot; rozetiyle görünür; vitrine, portallara, raporlara ve dış gönderimlere hiçbir zaman çıkmaz.
        {trialText ? " Deneme bitiminde paket seçimi Abonelik sayfasından yapılır." : ""}
      </p>
    </div>
  );
}

/** Örnek kayıtlara kaskatla bağlı gerçek kayıtlar (purge v3 ile aynı kural). Okunamazsa boş liste: purge yine reddeder. */
async function loadRealChildBlockers(supabase: Awaited<ReturnType<typeof createClient>>, tenantId: string): Promise<PurgeBlocker[]> {
  const { data, error } = await supabase.rpc("purge_sample_real_children", { p_tenant_id: tenantId });
  if (error) return [];
  return blockersFromDetail(data);
}
