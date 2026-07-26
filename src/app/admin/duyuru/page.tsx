import Link from "next/link";
import { Bell, History, Megaphone } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import { BroadcastForm, KIND_OPTIONS } from "./broadcast-form";

const audienceLabel: Record<string, string> = {
  all: "Tüm ofisler",
  active: "Aktif ofisler",
  trial: "Deneme ofisleri",
  specific: "Belirli ofis",
};

type AnnouncementRow = {
  id: string;
  title: string;
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

export default async function BroadcastPage() {
  await requirePlatformModule("broadcast");
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
    { data: history },
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
      .select("id, title, kind, audience, tenant_id, sent_count, created_at, tenant:tenants(name)")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const tenantOptions = (recentTenants ?? []).map((t) => ({
    value: t.id,
    label: t.name,
    hint: `/${t.slug} · ${t.status}`,
  }));

  const rows = (history ?? []) as unknown as AnnouncementRow[];

  return (
    <div className="space-y-6">
      {/* Başlık */}
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-amber-400/20 blur-[90px]" />
        <div className="relative">
          <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-amber-300">
            <Megaphone className="h-3.5 w-3.5" /> Toplu duyuru
          </p>
          <h1 className="mt-2 font-display text-2xl font-extrabold md:text-3xl">
            Ofislere duyuru gönder
          </h1>
          <p className="mt-1.5 max-w-lg text-sm text-white/60">
            Seçilen ofislerin bildirim kutusuna anlık mesaj iletir. Kullanıcılar ofis panelinden görür.
          </p>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        {/* Form — hedef kitle sayıları sunucuda hesaplandı */}
        <BroadcastForm
          audienceCounts={{ all: allCount ?? 0, active: activeCount ?? 0, trial: trialCount ?? 0 }}
          tenantOptions={tenantOptions}
        />

        {/* Bilgi paneli */}
        <aside className="space-y-4">
          <section className="rounded-[18px] border border-line bg-surface p-5">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-brand-600" />
              <h3 className="font-display font-bold text-ink-950">Nasıl çalışır?</h3>
            </div>
            <ul className="mt-4 space-y-3 text-sm text-text-muted">
              <li className="flex gap-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-600/10 text-[10px] font-bold text-brand-600">1</span>
                Duyuru, seçilen ofisin <strong className="text-ink-950">tüm kullanıcılarına</strong> görünür.
              </li>
              <li className="flex gap-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-600/10 text-[10px] font-bold text-brand-600">2</span>
                Ofis paneli topbar zili anında güncellenir; kullanıcı sayfayı yenilediğinde görür.
              </li>
              <li className="flex gap-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-600/10 text-[10px] font-bold text-brand-600">3</span>
                Bağlantı alanı doluysa bildirime tıklanınca ilgili sayfaya yönlendirir.
              </li>
              <li className="flex gap-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-600/10 text-[10px] font-bold text-brand-600">4</span>
                Gönderim geri alınamaz; dikkatlice doldurun.
              </li>
            </ul>
          </section>

          <section className="rounded-[18px] border border-line bg-surface p-5">
            <h3 className="font-display font-bold text-ink-950">Tür rehberi</h3>
            <div className="mt-3 space-y-2">
              {KIND_OPTIONS.map((k) => (
                <div key={k.value} className="flex items-center gap-3">
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${k.cls}`}>{k.label}</span>
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

          <div className="rounded-[14px] border border-amber-400/30 bg-amber-400/8 px-4 py-3 text-xs text-amber-700">
            <strong>Yetki:</strong> Yalnızca Süper admin ve Operasyon rolü duyuru gönderebilir.
          </div>
        </aside>
      </div>

      {/* Duyuru geçmişi — gönderim başına tek arşiv satırı */}
      <section className="overflow-hidden rounded-[20px] border border-line bg-surface">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
            <History className="h-4 w-4 text-brand-600" /> Son duyurular
          </h2>
          <span className="text-xs text-text-faint">Son {rows.length} gönderim</span>
        </div>
        {rows.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-text-muted">
            Henüz duyuru gönderilmemiş. Gönderimler burada arşivlenir.
          </p>
        ) : (
          <div className="divide-y divide-line">
            {rows.map((a) => {
              const kindOpt = KIND_OPTIONS.find((k) => k.value === a.kind);
              const tenantName = tenantNameOf(a.tenant);
              return (
                <div
                  key={a.id}
                  className="grid gap-2 px-5 py-3 transition hover:bg-brand-600/[0.02] sm:grid-cols-[1.4fr_1fr_auto_auto] sm:items-center"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${kindOpt?.cls ?? "bg-canvas text-text-muted"}`}>
                      {kindOpt?.label ?? a.kind}
                    </span>
                    <p className="truncate text-sm font-semibold text-ink-950">{a.title}</p>
                  </div>
                  <p className="text-xs text-text-muted">
                    {a.audience === "specific" && a.tenant_id ? (
                      <Link href={`/admin/tenants/${a.tenant_id}`} className="font-semibold text-brand-600 transition hover:underline">
                        {tenantName ?? "Belirli ofis"}
                      </Link>
                    ) : (
                      (audienceLabel[a.audience] ?? a.audience)
                    )}
                  </p>
                  <span className="numeric w-fit rounded-full bg-mint-500/10 px-2.5 py-1 text-[11px] font-bold text-mint-600">
                    {a.sent_count} ofis
                  </span>
                  <p className="text-xs text-text-faint">
                    {new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(a.created_at))}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
