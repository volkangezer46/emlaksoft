import { Activity, ArrowUpRight, ChevronDown, Search, ShieldCheck, UserCog, X } from "lucide-react";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import { auditActionLabel, relativeTimeTR } from "@/lib/admin-format";
import { daysAgoIso } from "@/lib/clock";
import { PAGE_SIZE, Pagination, parsePage } from "@/app/admin/_components/pagination";
import {
  activityHref,
  hasActivityFilter,
  parseActivityFilters,
  queryActivity,
  resolveActorNames,
  type ActivityFilters,
} from "@/lib/admin/activity-query";
import { ActivityExportButton } from "./activity-export-button";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { KpiCard, KpiGrid } from "@/components/ui/kpi-card";


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
      <div className="grid gap-3 text-xs sm:grid-cols-2">
        <div>
          <p className="mb-1 font-bold uppercase tracking-wide text-text-faint">Eski değer</p>
          <pre className="numeric whitespace-pre-wrap break-all rounded-[var(--radius-control)] bg-danger-500/6 p-2 text-danger-600">{pretty(oldValue)}</pre>
        </div>
        <div>
          <p className="mb-1 font-bold uppercase tracking-wide text-text-faint">Yeni değer</p>
          <pre className="numeric whitespace-pre-wrap break-all rounded-[var(--radius-control)] bg-mint-500/8 p-2 text-mint-700">{pretty(newValue)}</pre>
        </div>
      </div>
    );
  }

  const keys = [...new Set([...Object.keys(oldObj ?? {}), ...Object.keys(newObj ?? {})])];
  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[420px] grid-cols-[minmax(100px,auto)_1fr_1fr] gap-x-3 gap-y-1 text-xs">
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

const INPUT_CLS =
  "focus-ring w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-sm outline-none transition focus:border-brand-400";

const FILTER_LABELS: Record<string, string> = {
  q: "Arama",
  islem: "İşlem",
  kisi: "Kişi",
  ofis: "Ofis",
  baslangic: "Başlangıç",
  bitis: "Bitiş",
};

/** Sunucu süzgeci: GET formu (URL tek doğruluk kaynağı) + aktif süzgeç çipleri + CSV. */
function ActivityFilterBar({ filters, total }: { filters: ActivityFilters; total: number }) {
  const chips = (Object.keys(FILTER_LABELS) as (keyof ActivityFilters)[]).filter((k) => filters[k]);
  return (
    <form action="/admin/aktivite" role="search" className="space-y-3 rounded-[var(--radius-card)] border border-line bg-surface p-4">
      {filters.kaynak ? <input type="hidden" name="kaynak" value={filters.kaynak} /> : null}
      {filters.gun ? <input type="hidden" name="gun" value={filters.gun} /> : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="relative block">
          <span className="mb-1 block text-xs font-semibold text-text-muted">Arama (işlem veya varlık)</span>
          <Search className="pointer-events-none absolute bottom-2.5 left-3 h-3.5 w-3.5 text-text-faint" aria-hidden />
          <input type="search" name="q" defaultValue={filters.q} placeholder="ör. ticket, personel" className={`${INPUT_CLS} pl-9`} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-text-muted">İşlem türü</span>
          <input type="text" name="islem" defaultValue={filters.islem} placeholder="ör. platform_staff.role_change" className={INPUT_CLS} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-text-muted">Kişi (ad)</span>
          <input type="text" name="kisi" defaultValue={filters.kisi} placeholder="İşlemi yapan" className={INPUT_CLS} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-text-muted">Ofis (ad)</span>
          <input type="text" name="ofis" defaultValue={filters.ofis} placeholder="Yalnız ofis kayıtları" className={INPUT_CLS} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-text-muted">Başlangıç tarihi</span>
          <input type="date" name="baslangic" defaultValue={filters.baslangic} className={INPUT_CLS} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-text-muted">Bitiş tarihi</span>
          <input type="date" name="bitis" defaultValue={filters.bitis} className={INPUT_CLS} />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className="focus-ring press rounded-[var(--radius-control)] bg-ink-950 px-4 py-2 text-xs font-semibold text-white">
          Filtrele
        </button>
        {hasActivityFilter(filters) ? (
          <Link href="/admin/aktivite" className="focus-ring press rounded-[var(--radius-control)] border border-line px-3 py-2 text-xs font-semibold text-text-muted hover:text-ink-950">
            Tümünü temizle
          </Link>
        ) : null}
        {chips.map((k) => (
          <Link
            key={k}
            href={activityHref({ ...filters, [k]: undefined })}
            className="focus-ring press inline-flex items-center gap-1 rounded-full bg-brand-600/10 px-2.5 py-1 text-xs font-bold text-brand-600"
          >
            {FILTER_LABELS[k]}: {filters[k]} <X className="h-3 w-3" />
          </Link>
        ))}
        <span className="ml-auto flex items-center gap-3">
          <span className="text-xs text-text-faint">{total} kayıt eşleşiyor</span>
          <ActivityExportButton params={{ ...filters }} />
        </span>
      </div>
    </form>
  );
}

export default async function AdminActivityPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | undefined>>;
}) {
  await requirePlatformModule("activity");
  const sp = (await searchParams) ?? {};
  const filters = parseActivityFilters(sp);
  const { kaynak, gun } = filters;
  const filtered = hasActivityFilter(filters);
  const sayfa = parsePage(sp.sayfa);

  const admin = createAdminClient();
  const daySince = daysAgoIso(1);

  /*
   * İki kaynak (audit_logs + platform_audit_logs) tek listede birleşiyor.
   * Sayfalama için her kaynaktan `sayfa * 50` kayıt çekilir; birleşik listenin
   * ilk `sayfa * 50` kaydı her zaman bu iki dilimin içindedir — merge sonrası
   * dilimlemek doğru sonucu verir. Toplam, iki kaynağın exact count toplamı.
   * Süzgeç (işlem, kişi, ofis, arama, tarih aralığı) sunucuda `queryActivity` ile uygulanır;
   * CSV dışa aktarma aynı fonksiyonu kullanır.
   */
  const fetchEnd = sayfa * PAGE_SIZE - 1;

  // Sayaçlar her zaman tüm kaydı gösterir; filtre yalnızca listeyi daraltır
  const [
    activity,
    { count: tenantTotal },
    { count: platformTotal },
    { count: tenantToday },
    { count: platformToday },
  ] = await Promise.all([
    queryActivity(filters, fetchEnd),
    admin.from("audit_logs").select("id", { count: "exact", head: true }),
    admin.from("platform_audit_logs").select("id", { count: "exact", head: true }),
    admin.from("audit_logs").select("id", { count: "exact", head: true }).gte("created_at", daySince),
    admin.from("platform_audit_logs").select("id", { count: "exact", head: true }).gte("created_at", daySince),
  ]);

  const tenantRows = activity.tenantRows;
  const platformRows = activity.platformRows;
  const totalFiltered = activity.tenantCount + activity.platformCount;

  // İsim çözümleme — platform staff + tenant actor sorguları bağımsız, tek turda
  const platformActorIds = [
    ...new Set((platformRows ?? []).map((r) => r.actor_id).filter(Boolean)),
  ] as string[];
  const tenantActorIds = [
    ...new Set((tenantRows ?? []).map((r) => r.actor_id).filter(Boolean)),
  ] as string[];

  const { platform: platformNames, tenant: tenantNames } = await resolveActorNames(platformActorIds, tenantActorIds);

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
      href: activityHref({ ...filters, gun: gun === "bugun" ? undefined : "bugun" }),
      active: gun === "bugun",
    },
    {
      label: "Platform işlemi",
      value: platformTotal ?? 0,
      href: activityHref({ ...filters, kaynak: kaynak === "platform" ? undefined : "platform" }),
      active: kaynak === "platform",
    },
    {
      label: "Toplam kayıt",
      value: (tenantTotal ?? 0) + (platformTotal ?? 0),
      href: "/admin/aktivite",
      active: !filtered,
    },
  ];

  return (
    <div className="space-y-5">
      <AdminPageHeader
        art="shield"
        eyebrow="Denetim izi"
        icon={ShieldCheck}
        title="Platform aktivite kaydı"
        description="Tüm kritik işlemler, personel hareketleri ve operasyon kayıtları kronolojik sırayla."
      >
        <KpiGrid label="Aktivite sayaçları" className="lg:grid-cols-4 2xl:grid-cols-4">
          {counters.map((c) => (
            <KpiCard
              key={c.label}
              layout="inline"
              label={c.label}
              value={c.value}
              href={c.href}
              icon={Activity}
              tone={c.active ? "gold" : "brand"}
              tinted={c.active}
              hint={c.active ? "filtre aktif · kaldırmak için tıkla" : undefined}
            />
          ))}
        </KpiGrid>
      </AdminPageHeader>

      <ActivityFilterBar filters={filters} total={totalFiltered} />

      <section className="dashboard-panel overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface">
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink-950">
            <Activity className="h-4 w-4 text-brand-600" /> Hareketler
          </p>
          <span className="text-xs text-text-faint">
            {filtered ? `Filtrede ${totalFiltered} kayıt` : `${totalFiltered} kayıt`}
          </span>
        </div>

        {unified.length === 0 ? (
          <p className="py-16 text-center text-sm text-text-muted">
            {filtered ? "Filtreyle eşleşen aktivite kaydı yok." : "Henüz aktivite kaydı yok."}
          </p>
        ) : (
          <div className="divide-y divide-line">
            {unified.map((r) => {
              const hasDiff = r.oldValue != null || r.newValue != null;
              return (
                <details key={r.id} className="group">
                  <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-3 transition hover:bg-canvas/60 [&::-webkit-details-marker]:hidden">
                    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-control)] ${
                      r.isPlatform
                        ? "bg-cyan-400/15 text-cyan-600"
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
                      <p className="truncate text-xs text-text-faint">
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
                    <span className="shrink-0 text-xs text-text-faint">{relativeTimeTR(r.createdAt)}</span>
                    <ChevronDown className="h-4 w-4 shrink-0 text-text-faint transition group-open:rotate-180" />
                  </summary>
                  <div className="border-t border-line/60 bg-canvas/40 px-5 py-4 sm:pl-[68px]">
                    {hasDiff ? (
                      <DiffPanel oldValue={r.oldValue} newValue={r.newValue} />
                    ) : r.meta != null ? (
                      <pre className="numeric overflow-x-auto whitespace-pre-wrap break-all rounded-[var(--radius-control)] bg-surface p-3 text-xs leading-relaxed text-text-muted">
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
        hrefFor={(p) => activityHref(filters, { sayfa: p })}
      />
    </div>
  );
}
