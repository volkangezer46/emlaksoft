import { PageHeader } from "@/components/ui/page-header";
import { Alert } from "@/components/ui/alert";
import { requireModulePage } from "@/lib/require-module-page";
import { createClient } from "@/lib/supabase/server";
import { now } from "@/lib/clock";
import { loadSampleStatus } from "@/lib/sample-status";
import { REAL_USE_HREF, canSwitchToRealUse } from "@/lib/sample-data/real-use";
import { trialDaysLeft, trialLabel } from "@/lib/sample-data/trial";
import { RealUseDone, RealUseSwitch } from "./real-use-switch";

export const metadata = { title: "Gerçek kullanıma geç" };

/**
 * Tek tuş "Gerçek kullanıma geç": örnek verileri sayılarla gösterir, onay alır, kalıcı siler.
 * Kabuk şeridi ve Ayarlar kartı buraya gelir. Sayılar oturum istemcisiyle (RLS) okunur; silme
 * `clearSampleData` (owner/gm kapısı + RPC) ile yapılır. Örnek veri yoksa başarı/sonraki adımlar ekranı.
 */
export default async function RealUsePage() {
  const { tenantId, role } = await requireModulePage("settings", REAL_USE_HREF);
  const crumbs = [{ label: "Ayarlar", href: "/app/ayarlar" }, { label: "Gerçek kullanıma geç" }];
  if (!tenantId) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <PageHeader title="Gerçek kullanıma geç" breadcrumbs={crumbs} />
        <Alert tone="info">Bu işlem bir ofis hesabı içinde yapılır.</Alert>
      </div>
    );
  }

  const supabase = await createClient();
  const { data: tenant } = await supabase.from("tenants").select("sample_seeded_at, status, trial_ends_at").eq("id", tenantId).maybeSingle();
  const status = await loadSampleStatus(supabase, tenantId, tenant?.sample_seeded_at ?? null).catch(() => null);
  const days = tenant?.status === "trial" ? trialDaysLeft(tenant.trial_ends_at, now()) : null;
  const trialText = trialLabel(days);
  const canClear = canSwitchToRealUse(role);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <PageHeader
        eyebrow="Ayarlar"
        title="Gerçek kullanıma geç"
        description="Örnek (demo) kayıtları tek adımda kaldır; ofisin yalnız kendi verinle çalışsın. Deneme süren ve paketin bu işlemden etkilenmez."
        breadcrumbs={crumbs}
        meta={trialText ? <span className="rounded-full bg-amber-400/15 px-2.5 py-1 text-xs font-bold text-amber-700">{trialText}</span> : null}
      />
      {!status ? (
        <Alert tone="danger">Örnek veri durumu okunamadı. Sayfayı yenileyip tekrar deneyin.</Alert>
      ) : status.active && status.total > 0 ? (
        <RealUseSwitch rows={status.rows.map((r) => ({ label: r.label, count: r.count }))} total={status.total} canClear={canClear} />
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
