import Link from "@/components/ui/smart-link";
import { ArrowLeft, Building2, Database, Lock, RotateCcw, Settings2, Sparkles } from "lucide-react";
import { requirePlatformModule } from "@/lib/platform";
import { createAdminClient } from "@/lib/supabase/admin";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { KpiCard, KpiGrid } from "@/components/ui/kpi-card";
import { Alert } from "@/components/ui/alert";
import { DEMO_TENANT_SLUG } from "@/lib/demo-tenant";
import { getSettings } from "@/lib/settings/read";
import { DEMO_SETTING_KEYS } from "@/lib/settings/registry/demo";
import { relativeTimeTR } from "@/lib/admin-format";
import { PublicDemoReset } from "./public-demo-reset";

export const metadata = { title: "Demo verisi" };

const PACK_LABEL: Record<string, string> = { konut: "Konut ağırlıklı", ticari: "Ticari ağırlıklı", arsa: "Arsa ağırlıklı" };

/**
 * DEMO VERİSİ MERKEZİ (platform, `tenants` modülü; proxy-gates satırı `/admin/tenants/demo`). Tek bakışta: kaç ofis demo
 * modunda / gerçek kullanıma kilitli, yeni ofislere otomatik demo ayarı, genel demo ofisinin (giriş kartları) son sıfırlanması,
 * tohum görüntüsü ve kalan [SAHA] test kalıntısı. Ofis bazında işlemler Ofis 360 > Yönetim > Demo verisi panelindedir.
 */
export default async function AdminDemoDataPage() {
  const staff = await requirePlatformModule("tenants");
  const admin = createAdminClient();
  const [demoCount, lockedCount, { data: demoTenant }, settings] = await Promise.all([
    admin.from("tenants").select("id", { count: "exact", head: true }).not("sample_seeded_at", "is", null),
    admin.from("tenants").select("id", { count: "exact", head: true }).not("real_use_at", "is", null),
    admin.from("tenants").select("id, name").eq("slug", DEMO_TENANT_SLUG).maybeSingle(),
    getSettings([DEMO_SETTING_KEYS.autoSeed, DEMO_SETTING_KEYS.defaultPack]).catch(() => ({}) as Record<string, unknown>),
  ]);
  const demoId = (demoTenant as { id?: string } | null)?.id ?? null;
  const [state, snapshot, saha] = demoId
    ? await Promise.all([
        admin.from("demo_reset_state").select("baseline_at, last_reset_at").eq("tenant_id", demoId).maybeSingle(),
        admin.from("demo_reset_snapshots").select("row_id", { count: "exact", head: true }).eq("tenant_id", demoId),
        admin.rpc("demo_tenant_saha_cleanup", { p_tenant_id: demoId, p_dry_run: true }),
      ])
    : [null, null, null];
  const st = (state?.data ?? null) as { baseline_at?: string | null; last_reset_at?: string | null } | null;
  const sahaTotal = saha && !saha.error ? Number((saha.data as { total?: number } | null)?.total ?? 0) : null;
  const autoSeed = settings[DEMO_SETTING_KEYS.autoSeed] !== false;
  const pack = String(settings[DEMO_SETTING_KEYS.defaultPack] ?? "konut");
  const isSuper = staff.role === "super_admin";

  return (
    <div className="space-y-6">
      <Link href="/admin/tenants" className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted hover:text-brand-600">
        <ArrowLeft className="h-4 w-4" /> Ofis listesi
      </Link>
      <AdminPageHeader
        art="office"
        eyebrow="Ofisler"
        title="Demo verisi"
        description="Yeni ofislerin örnek verisi, gerçek kullanım kilidi ve genel demo ofisinin gece sıfırlaması"
      >
        <KpiGrid label="Demo göstergeleri">
          <KpiCard layout="inline" label="Demo modunda" value={String(demoCount.count ?? 0)} href="/admin/tenants?veri=demo" icon={Sparkles} tone="brand" />
          <KpiCard layout="inline" label="Gerçek kullanıma kilitli" value={String(lockedCount.count ?? 0)} href="/admin/tenants?veri=gercek" icon={Lock} tone="brand" />
          <KpiCard
            layout="inline"
            label="Yeni ofislere demo"
            value={autoSeed ? "Açık" : "Kapalı"}
            hint={PACK_LABEL[pack] ?? pack}
            href="/admin/ayarlar?kategori=kayit-bakim"
            icon={Settings2}
            tone="brand"
          />
        </KpiGrid>
      </AdminPageHeader>

      <section className="dashboard-panel space-y-4 rounded-[var(--radius-panel)] border border-line bg-surface p-5" aria-label="Genel demo ofisi">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <Building2 className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" aria-hidden />
            <div>
              <h2 className="font-display font-bold text-ink-950">Genel demo ofisi</h2>
              <p className="text-xs text-text-muted">
                Giriş sayfasındaki demo kartlarının ofisi. Her gece ziyaretçi eklemeleri silinir, [SAHA] test kalıntıları temizlenir ve tohum kayıtları
                görüntüden geri yüklenir.
              </p>
            </div>
          </div>
          {demoId ? (
            <Link href={`/admin/tenants/${demoId}?sekme=yonetim`} className="text-sm font-semibold text-brand-600 hover:text-brand-700">
              Ofis 360
            </Link>
          ) : null}
        </div>
        {!demoId ? (
          <Alert tone="info">Genel demo ofisi (slug {DEMO_TENANT_SLUG}) henüz açılmamış; ilk demo girişinde ya da tohum betiğiyle açılır.</Alert>
        ) : (
          <>
            <dl className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <Fact icon={RotateCcw} label="Son sıfırlama" value={st?.last_reset_at ? relativeTimeTR(st.last_reset_at) : "—"} />
              <Fact icon={Database} label="Taban (tohum anı)" value={st?.baseline_at ? relativeTimeTR(st.baseline_at) : "—"} />
              <Fact icon={Database} label="Tohum görüntüsü" value={snapshot && !snapshot.error ? `${snapshot.count ?? 0} satır` : "Kurulu değil"} />
              <Fact icon={Sparkles} label="[SAHA] kalıntısı" value={sahaTotal == null ? "Kurulu değil" : String(sahaTotal)} />
            </dl>
            {sahaTotal ? (
              <Alert tone="warning">
                Demo ofiste {sahaTotal} test kaydı var. Gece sıfırlaması ya da aşağıdaki düğme temizler; saha testleri artık ayrı QA ofisini hedeflemeli.
              </Alert>
            ) : null}
            {isSuper ? <PublicDemoReset /> : <p className="text-xs text-text-muted">Sıfırlama yalnız süper admin içindir.</p>}
          </>
        )}
      </section>
    </div>
  );
}

function Fact({ icon: Icon, label, value }: { icon: typeof Database; label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-control)] border border-line px-3 py-2">
      <dt className="flex items-center gap-1.5 text-xs text-text-muted">
        <Icon className="h-3.5 w-3.5" aria-hidden /> {label}
      </dt>
      <dd className="font-semibold text-ink-950">{value}</dd>
    </div>
  );
}
