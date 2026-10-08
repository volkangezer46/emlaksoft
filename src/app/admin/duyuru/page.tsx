import { ButtonLink } from "@/components/ui/button";
import { Bell, History, Megaphone, Send } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import { Pagination, pageRange, parsePage } from "@/app/admin/_components/pagination";
import { BroadcastForm } from "./broadcast-form";
import { BroadcastRow } from "./broadcast-row";
import { KIND_OPTIONS } from "./broadcast-options";
import { AdminPageHeader } from "@/components/admin/admin-page-header";

const audienceLabel: Record<string, string> = {
  all: "Tüm ofisler",
  active: "Aktif ofisler",
  trial: "Deneme ofisleri",
  specific: "Belirli ofis",
};

type AnnouncementRow = {
  id: string;
  title: string;
  body: string | null;
  kind: string;
  audience: string;
  tenant_id: string | null;
  sent_count: number;
  created_at: string;
  tenant: { name?: string } | { name?: string }[] | null;
};

function tenantNameOf(v: AnnouncementRow["tenant"]) {
  if (!v) return null;
  return (Array.isArray(v) ? v[0]?.name : v.name) ?? null;
}

export default async function BroadcastPage({ searchParams }: { searchParams: Promise<{ yeni?: string; sayfa?: string }> }) {
  const staff = await requirePlatformModule("broadcast");
  const canEdit = ["super_admin", "ops"].includes(staff.role);
  const isSuperAdmin = staff.role === "super_admin";
  const { yeni, sayfa } = await searchParams;
  const page = parsePage(sayfa);
  const admin = createAdminClient();

  /*
   * Hedef kitle sayıları + combobox kısayol listesi + duyuru geçmişi tek turda.
   * Sayılar client'a props olarak iner: audience değişince istek atılmaz.
   */
  const [
    { count: allCount },
    { count: activeCount },
    { count: trialCount },
    { data: recentTenants },
    { data: history, count: historyTotal },
  ] = await Promise.all([
    admin.from("tenants").select("id", { count: "exact", head: true }).neq("status", "cancelled"),
    admin.from("tenants").select("id", { count: "exact", head: true }).eq("status", "active"),
    admin.from("tenants").select("id", { count: "exact", head: true }).eq("status", "trial"),
    admin
      .from("tenants")
      .select("id, name, slug, status")
      .neq("status", "cancelled")
      .order("created_at", { ascending: false })
      .limit(20),
    admin
      .from("platform_announcements")
      .select("id, title, body, kind, audience, tenant_id, sent_count, created_at, tenant:tenants(name)", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(...pageRange(page)),
  ]);

  const tenantOptions = (recentTenants ?? []).map((t) => ({
    value: t.id,
    label: t.name,
    hint: `/${t.slug} · ${t.status}`,
  }));

  const rows = (history ?? []) as unknown as AnnouncementRow[];

  // Yeni duyuru: tam sayfa sekmeli form (hedef sayıları yukarıda hazır).
  if (yeni === "1") {
    return (
      <BroadcastForm
        audienceCounts={{ all: allCount ?? 0, active: activeCount ?? 0, trial: trialCount ?? 0 }}
        tenantOptions={tenantOptions}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Satır içi düzenleme paneli burada açılır; popup yok. */}
      <div id="inline-panel-host" className="min-w-0 empty:hidden" />
      {/* Başlık */}
      <AdminPageHeader
        art="megaphone"
        eyebrow="Toplu duyuru"
        icon={Megaphone}
        title="Ofislere duyuru gönder"
        description="Seçilen ofislerin bildirim kutusuna anlık mesaj iletir. Kullanıcılar ofis panelinden görür."
      />

      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <section className="dashboard-panel flex flex-col items-start gap-3 rounded-[var(--radius-panel)] border border-line bg-surface p-6">
          <h2 className="font-display font-bold text-ink-950">Duyuru oluştur</h2>
          <p className="text-sm text-text-muted">
            Hedef kitle: {allCount ?? 0} ofis (aktif {activeCount ?? 0}, deneme {trialCount ?? 0}). İçerik, tür ve hedefi sekmeli formda canlı özetle birlikte hazırlayın.
          </p>
          <ButtonLink variant="navy" size="md" href="/admin/duyuru?yeni=1" className="btn-shine">
            <Send className="h-4 w-4" /> Yeni duyuru
          </ButtonLink>
        </section>

        {/* Bilgi paneli */}
        <aside className="space-y-4">
          <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-brand-600" />
              <h3 className="font-display font-bold text-ink-950">Nasıl çalışır?</h3>
            </div>
            <ul className="mt-4 space-y-3 text-sm text-text-muted">
              <li className="flex gap-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-600/10 text-xs font-bold text-brand-600">1</span>
                Duyuru, seçilen ofisin <strong className="text-ink-950">tüm kullanıcılarına</strong> görünür.
              </li>
              <li className="flex gap-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-600/10 text-xs font-bold text-brand-600">2</span>
                Ofis paneli topbar zili anında güncellenir; kullanıcı sayfayı yenilediğinde görür.
              </li>
              <li className="flex gap-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-600/10 text-xs font-bold text-brand-600">3</span>
                Bağlantı alanı doluysa bildirime tıklanınca ilgili sayfaya yönlendirir.
              </li>
              <li className="flex gap-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-600/10 text-xs font-bold text-brand-600">4</span>
                Gönderim geri alınamaz; dikkatlice doldurun.
              </li>
            </ul>
          </section>

          <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5">
            <h3 className="font-display font-bold text-ink-950">Tür rehberi</h3>
            <div className="mt-3 space-y-2">
              {KIND_OPTIONS.map((k) => (
                <div key={k.value} className="flex items-center gap-3">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${k.cls}`}>{k.label}</span>
                  <span className="text-xs text-text-muted">
                    {k.value === "info" && "Yeni özellik, duyuru, genel bilgi"}
                    {k.value === "success" && "Başarılı güncelleme, plan yükseltme"}
                    {k.value === "warning" && "Bakım, geçici kısıtlama, dikkat"}
                    {k.value === "danger" && "Kritik kesinti, acil müdahale"}
                    {k.value === "system" && "Otomatik sistem mesajı"}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <div className="rounded-[var(--radius-card)] border border-amber-400/30 bg-amber-400/8 px-4 py-3 text-xs text-amber-700">
            <strong>Yetki:</strong> Yalnızca Süper admin ve Operasyon rolü duyuru gönderebilir.
          </div>
        </aside>
      </div>

      {/* Duyuru geçmişi — gönderim başına tek arşiv satırı */}
      <section className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
            <History className="h-4 w-4 text-brand-600" /> Son duyurular
          </h2>
          <span className="text-xs text-text-faint">Toplam {historyTotal ?? 0} gönderim</span>
        </div>
        {rows.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-text-muted">
            Henüz duyuru gönderilmemiş. Gönderimler burada arşivlenir.
          </p>
        ) : (
          <div className="divide-y divide-line">
            {rows.map((a) => (
              <BroadcastRow
                key={a.id}
                canEdit={canEdit}
                isSuperAdmin={isSuperAdmin}
                row={{
                  id: a.id,
                  title: a.title,
                  body: a.body,
                  kind: a.kind,
                  audienceLabel: audienceLabel[a.audience] ?? a.audience,
                  tenantId: a.audience === "specific" ? a.tenant_id : null,
                  tenantName: tenantNameOf(a.tenant),
                  sentCount: a.sent_count,
                  createdLabel: new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(a.created_at)),
                }}
              />
            ))}
          </div>
        )}
        <div className="px-5 pb-4">
          <Pagination page={page} total={historyTotal ?? 0} hrefFor={(p) => (p > 1 ? `/admin/duyuru?sayfa=${p}` : "/admin/duyuru")} />
        </div>
      </section>
    </div>
  );
}
