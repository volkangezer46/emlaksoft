import { Activity, ArrowUpRight, ShieldCheck, UserCog } from "lucide-react";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import { auditActionLabel, relativeTimeTR } from "@/lib/admin-format";

export default async function AdminActivityPage() {
  await requirePlatformModule("activity");
  const admin = createAdminClient();

  // Tenant audit logs + platform staff audit logs paralel çek
  const [{ data: tenantRows }, { data: platformRows }] = await Promise.all([
    admin
      .from("audit_logs")
      .select("id, action, entity_type, entity_id, actor_id, tenant_id, old_value, new_value, created_at, tenant:tenants(name)")
      .order("created_at", { ascending: false })
      .limit(100),
    admin
      .from("platform_audit_logs")
      .select("id, action, entity_type, entity_id, actor_id, meta, created_at")
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  // Platform staff isimlerini çek
  const platformActorIds = [
    ...new Set((platformRows ?? []).map((r) => r.actor_id).filter(Boolean)),
  ] as string[];
  const platformNames = new Map<string, string>();
  if (platformActorIds.length) {
    const { data: staffList } = await admin
      .from("platform_staff")
      .select("id, full_name")
      .in("id", platformActorIds);
    for (const s of staffList ?? []) platformNames.set(s.id, s.full_name);
  }

  // Tenant actor isimlerini çek
  const tenantActorIds = [
    ...new Set((tenantRows ?? []).map((r) => r.actor_id).filter(Boolean)),
  ] as string[];
  const tenantNames = new Map<string, string>();
  if (tenantActorIds.length) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, full_name")
      .in("id", tenantActorIds);
    for (const p of profiles ?? []) tenantNames.set(p.id, p.full_name);
  }

  // İki listeyi birleştir ve tarihe göre sırala
  type UnifiedRow = {
    id: string;
    action: string;
    entityType: string | null;
    actorLabel: string;
    scopeLabel: string;
    tenantId: string | null;
    createdAt: string;
    isPlatform: boolean;
  };

  const unified: UnifiedRow[] = [
    ...(platformRows ?? []).map((r) => ({
      id: r.id,
      action: r.action,
      entityType: r.entity_type ?? null,
      actorLabel: r.actor_id ? (platformNames.get(r.actor_id) ?? r.actor_id.slice(0, 8)) : "Sistem",
      scopeLabel: "Platform",
      tenantId: null,
      createdAt: r.created_at,
      isPlatform: true,
    })),
    ...(tenantRows ?? []).map((r) => {
      const tenantName = Array.isArray(r.tenant)
        ? r.tenant[0]?.name
        : (r.tenant as { name?: string } | null)?.name;
      return {
        id: r.id,
        action: r.action,
        entityType: r.entity_type ?? null,
        actorLabel: r.actor_id ? (tenantNames.get(r.actor_id) ?? r.actor_id.slice(0, 8)) : "Sistem",
        scopeLabel: tenantName ?? "Ofis",
        tenantId: r.tenant_id ?? null,
        createdAt: r.created_at,
        isPlatform: false,
      };
    }),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
   .slice(0, 150);

  const today = unified.filter((r) => Date.now() - new Date(r.createdAt).getTime() < 86_400_000).length;
  const platformCount = unified.filter((r) => r.isPlatform).length;

  return (
    <div className="space-y-5">
      <section className="theme-dark relative overflow-hidden rounded-[20px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
        <div className="pointer-events-none absolute -right-14 -top-14 h-52 w-52 rounded-full bg-brand-500/25 blur-[90px]" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="flex items-center gap-2 text-xs font-semibold text-brand-300">
              <ShieldCheck className="h-4 w-4" /> Denetim izi
            </span>
            <h1 className="mt-2 font-display text-2xl font-extrabold text-white md:text-3xl">Platform aktivite kaydı</h1>
            <p className="mt-1 max-w-lg text-sm text-white/75">
              Tüm kritik işlemler, personel hareketleri ve operasyon kayıtları kronolojik sırayla.
            </p>
          </div>
          <div className="flex gap-3">
            <div className="rounded-[14px] border border-white/12 bg-white/8 p-3 text-center">
              <p className="font-display text-2xl font-extrabold text-white">{today}</p>
              <p className="text-[10px] text-white/70">Bugün</p>
            </div>
            <div className="rounded-[14px] border border-white/12 bg-white/8 p-3 text-center">
              <p className="font-display text-2xl font-extrabold text-white">{platformCount}</p>
              <p className="text-[10px] text-white/70">Platform işlemi</p>
            </div>
            <div className="rounded-[14px] border border-white/12 bg-white/8 p-3 text-center">
              <p className="font-display text-2xl font-extrabold text-white">{unified.length}</p>
              <p className="text-[10px] text-white/70">Toplam kayıt</p>
            </div>
          </div>
        </div>
      </section>

      <section className="dashboard-panel overflow-hidden rounded-[20px] border border-line bg-surface">
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink-950">
            <Activity className="h-4 w-4 text-brand-600" /> Hareketler
          </p>
          <span className="text-xs text-text-faint">Son {unified.length} kayıt</span>
        </div>

        {unified.length === 0 ? (
          <p className="py-16 text-center text-sm text-text-muted">Henüz aktivite kaydı yok.</p>
        ) : (
          <div className="divide-y divide-line">
            {unified.map((r) => (
              <div key={r.id} className="flex items-center gap-3 px-5 py-3 transition hover:bg-canvas/60">
                <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-[10px] ${
                  r.isPlatform
                    ? "bg-violet-500/12 text-violet-600"
                    : r.action.startsWith("ops.")
                      ? "bg-amber-400/15 text-amber-600"
                      : "bg-brand-600/8 text-brand-600"
                }`}>
                  {r.isPlatform ? (
                    <UserCog className="h-4 w-4" />
                  ) : (
                    <Activity className="h-4 w-4" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink-950">{auditActionLabel(r.action)}</p>
                  <p className="truncate text-[11px] text-text-faint">
                    {r.actorLabel} · {r.scopeLabel}
                    {r.entityType ? ` · ${r.entityType}` : ""}
                  </p>
                </div>
                {r.tenantId ? (
                  <Link
                    href={`/admin/tenants/${r.tenantId}`}
                    className="hidden shrink-0 items-center gap-1 text-xs font-semibold text-brand-600 hover:underline sm:inline-flex"
                  >
                    Ofis <ArrowUpRight className="h-3 w-3" />
                  </Link>
                ) : null}
                <span className="shrink-0 text-[11px] text-text-faint">{relativeTimeTR(r.createdAt)}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
