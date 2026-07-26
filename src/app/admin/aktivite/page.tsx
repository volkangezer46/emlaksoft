import { Activity, ArrowUpRight, ChevronDown, ShieldCheck, UserCog } from "lucide-react";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import { auditActionLabel, relativeTimeTR } from "@/lib/admin-format";
import { daysAgoIso } from "@/lib/clock";
import { PAGE_SIZE, Pagination, parsePage } from "@/app/admin/_components/pagination";

function buildHref(p: { kaynak?: string; gun?: string; sayfa?: number }) {
  const sp = new URLSearchParams();
  if (p.kaynak) sp.set("kaynak", p.kaynak);
  if (p.gun) sp.set("gun", p.gun);
  if (p.sayfa && p.sayfa > 1) sp.set("sayfa", String(p.sayfa));
  const s = sp.toString();
  return s ? `/admin/aktivite?${s}` : "/admin/aktivite";
}

function pretty(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  return JSON.stringify(v, null, 2);
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** old_value/new_value JSON'larını yan yana, değişen satırları renkli gösterir. */
function DiffPanel({ oldValue, newValue }: { oldValue: unknown; newValue: unknown }) {
  const oldObj = asRecord(oldValue);
  const newObj = asRecord(newValue);

  if (!oldObj && !newObj) {
    return (
      <div className="grid gap-3 text-[11px] sm:grid-cols-2">
        <div>
          <p className="mb-1 font-bold uppercase tracking-wide text-text-faint">Eski değer</p>
          <pre className="numeric whitespace-pre-wrap break-all rounded-[8px] bg-danger-500/6 p-2 text-danger-600">{pretty(oldValue)}</pre>
        </div>
        <div>
          <p className="mb-1 font-bold uppercase tracking-wide text-text-faint">Yeni değer</p>
          <pre className="numeric whitespace-pre-wrap break-all rounded-[8px] bg-mint-500/8 p-2 text-mint-700">{pretty(newValue)}</pre>
        </div>
      </div>
    );
  }

  const keys = [...new Set([...Object.keys(oldObj ?? {}), ...Object.keys(newObj ?? {})])];
  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[420px] grid-cols-[minmax(100px,auto)_1fr_1fr] gap-x-3 gap-y-1 text-[11px]">
        <span className="pb-1 font-bold uppercase tracking-wide text-text-faint">Alan</span>
        <span className="pb-1 font-bold uppercase tracking-wide text-text-faint">Eski değer</span>
        <span className="pb-1 font-bold uppercase tracking-wide text-text-faint">Yeni değer</span>
        {keys.map((k) => {
          const o = oldObj?.[k];
          const n = newObj?.[k];
          const changed = JSON.stringify(o) !== JSON.stringify(n);
          return (
            <div key={k} className="contents">
              <span className="numeric py-0.5 font-semibold text-ink-950">{k}</span>
              <span
                className={`numeric whitespace-pre-wrap break-all py-0.5 ${
                  changed ? "rounded-[6px] bg-danger-500/8 px-1.5 font-semibold text-danger-600" : "text-text-muted"
                }`}
              >
                {pretty(o)}
              </span>
              <span
                className={`numeric whitespace-pre-wrap break-all py-0.5 ${
                  changed ? "rounded-[6px] bg-mint-500/10 px-1.5 font-semibold text-mint-700" : "text-text-muted"
                }`}
              >
                {pretty(n)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default async function AdminActivityPage({
  searchParams,
}: {
  searchParams?: Promise<{ kaynak?: string; gun?: string; sayfa?: string }>;
}) {
  await requirePlatformModule("activity");
  const sp = (await searchParams) ?? {};
  const kaynak = sp.kaynak === "platform" || sp.kaynak === "tenant" ? sp.kaynak : undefined;
  const gun = sp.gun === "bugun" ? sp.gun : undefined;
  const sayfa = parsePage(sp.sayfa);

  const admin = createAdminClient();
  const daySince = daysAgoIso(1);

  /*
   * İki kaynak (audit_logs + platform_audit_logs) tek listede birleşiyor.
   * Sayfalama için her kaynaktan `sayfa * 50` kayıt çekilir; birleşik listenin
   * ilk `sayfa * 50` kaydı her zaman bu iki dilimin içindedir — merge sonrası
   * dilimlemek doğru sonucu verir. Toplam, iki kaynağın exact count toplamı.
   */
  const includeTenant = kaynak !== "platform";
  const includePlatform = kaynak !== "tenant";
  const fetchEnd = sayfa * PAGE_SIZE - 1;

  let tenantQ = admin
    .from("audit_logs")
    .select("id, action, entity_type, entity_id, actor_id, tenant_id, old_value, new_value, created_at, tenant:tenants(name)", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(0, fetchEnd);
  if (gun) tenantQ = tenantQ.gte("created_at", daySince);

  let platformQ = admin
    .from("platform_audit_logs")
    .select("id, action, entity_type, entity_id, actor_id, meta, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(0, fetchEnd);
  if (gun) platformQ = platformQ.gte("created_at", daySince);

  // Sayaçlar her zaman tüm kaydı gösterir; filtre yalnızca listeyi daraltır
  const [
    tenantRes,
    platformRes,
    { count: tenantTotal },
    { count: platformTotal },
    { count: tenantToday },
    { count: platformToday },
  ] = await Promise.all([
    includeTenant ? tenantQ : Promise.resolve({ data: null, count: 0 }),
    includePlatform ? platformQ : Promise.resolve({ data: null, count: 0 }),
    admin.from("audit_logs").select("id", { count: "exact", head: true }),
    admin.from("platform_audit_logs").select("id", { count: "exact", head: true }),
    admin.from("audit_logs").select("id", { count: "exact", head: true }).gte("created_at", daySince),
    admin.from("platform_audit_logs").select("id", { count: "exact", head: true }).gte("created_at", daySince),
  ]);

  const tenantRows = tenantRes.data ?? [];
  const platformRows = platformRes.data ?? [];
  const totalFiltered = (includeTenant ? (tenantRes.count ?? 0) : 0) + (includePlatform ? (platformRes.count ?? 0) : 0);

  // İsim çözümleme — platform staff + tenant actor sorguları bağımsız, tek turda
  const platformActorIds = [
    ...new Set((platformRows ?? []).map((r) => r.actor_id).filter(Boolean)),
  ] as string[];
  const tenantActorIds = [
    ...new Set((tenantRows ?? []).map((r) => r.actor_id).filter(Boolean)),
  ] as string[];

  const [{ data: staffList }, { data: profiles }] = await Promise.all([
    platformActorIds.length
      ? admin.from("platform_staff").select("id, full_name").in("id", platformActorIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    tenantActorIds.length
      ? admin.from("profiles").select("id, full_name").in("id", tenantActorIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
  ]);

  const platformNames = new Map<string, string>();
  for (const s of staffList ?? []) platformNames.set(s.id, s.full_name);
  const tenantNames = new Map<string, string>();
  for (const p of profiles ?? []) tenantNames.set(p.id, p.full_name);

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
    oldValue: unknown;
    newValue: unknown;
    meta: unknown;
  };

  const allUnified: UnifiedRow[] = [
    ...(platformRows ?? []).map((r) => ({
      id: r.id,
      action: r.action,
      entityType: r.entity_type ?? null,
      actorLabel: r.actor_id ? (platformNames.get(r.actor_id) ?? r.actor_id.slice(0, 8)) : "Sistem",
      scopeLabel: "Platform",
      tenantId: null,
      createdAt: r.created_at,
      isPlatform: true,
      oldValue: null as unknown,
      newValue: null as unknown,
      meta: r.meta as unknown,
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
        oldValue: r.old_value as unknown,
        newValue: r.new_value as unknown,
        meta: null as unknown,
      };
    }),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  // Kaynak/gün filtresi sorgu seviyesinde uygulandı; burada yalnızca sayfa dilimi kesilir.
  const unified = allUnified.slice((sayfa - 1) * PAGE_SIZE, sayfa * PAGE_SIZE);

  const counters = [
    {
      label: "Bugün",
      value: (tenantToday ?? 0) + (platformToday ?? 0),
      href: buildHref({ kaynak, gun: gun === "bugun" ? undefined : "bugun" }),
      active: gun === "bugun",
    },
    {
      label: "Platform işlemi",
      value: platformTotal ?? 0,
      href: buildHref({ kaynak: kaynak === "platform" ? undefined : "platform", gun }),
      active: kaynak === "platform",
    },
    {
      label: "Toplam kayıt",
      value: (tenantTotal ?? 0) + (platformTotal ?? 0),
      href: "/admin/aktivite",
      active: !kaynak && !gun,
    },
  ];

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
            {counters.map((c) => (
              <Link
                key={c.label}
                href={c.href}
                aria-current={c.active ? "page" : undefined}
                className={`focus-ring press block rounded-[14px] border p-3 text-center transition ${
                  c.active
                    ? "border-brand-400/60 bg-white/15"
                    : "border-white/12 bg-white/8 hover:border-white/25 hover:bg-white/12"
                }`}
              >
                <p className="font-display text-2xl font-extrabold text-white">{c.value}</p>
                <p className="text-[11px] text-white/70">{c.label}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="dashboard-panel overflow-hidden rounded-[20px] border border-line bg-surface">
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink-950">
            <Activity className="h-4 w-4 text-brand-600" /> Hareketler
          </p>
          <span className="text-xs text-text-faint">
            {kaynak || gun ? `Filtrede ${totalFiltered} kayıt` : `${totalFiltered} kayıt`}
          </span>
        </div>

        {unified.length === 0 ? (
          <p className="py-16 text-center text-sm text-text-muted">
            {kaynak || gun ? "Filtreyle eşleşen aktivite kaydı yok." : "Henüz aktivite kaydı yok."}
          </p>
        ) : (
          <div className="divide-y divide-line">
            {unified.map((r) => {
              const hasDiff = r.oldValue != null || r.newValue != null;
              return (
                <details key={r.id} className="group">
                  <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-3 transition hover:bg-canvas/60 [&::-webkit-details-marker]:hidden">
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
                        className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-brand-600 hover:underline"
                      >
                        Ofis <ArrowUpRight className="h-3 w-3" />
                      </Link>
                    ) : null}
                    <span className="shrink-0 text-[11px] text-text-faint">{relativeTimeTR(r.createdAt)}</span>
                    <ChevronDown className="h-4 w-4 shrink-0 text-text-faint transition group-open:rotate-180" />
                  </summary>
                  <div className="border-t border-line/60 bg-canvas/40 px-5 py-4 sm:pl-[68px]">
                    {hasDiff ? (
                      <DiffPanel oldValue={r.oldValue} newValue={r.newValue} />
                    ) : r.meta != null ? (
                      <pre className="numeric overflow-x-auto whitespace-pre-wrap break-all rounded-[8px] bg-surface p-3 text-[11px] leading-relaxed text-text-muted">
                        {pretty(r.meta)}
                      </pre>
                    ) : (
                      <p className="text-xs text-text-muted">Bu kayıt için ek detay verisi yok.</p>
                    )}
                  </div>
                </details>
              );
            })}
          </div>
        )}
      </section>

      <Pagination
        page={sayfa}
        total={totalFiltered}
        hrefFor={(p) => buildHref({ kaynak, gun, sayfa: p })}
      />
    </div>
  );
}
