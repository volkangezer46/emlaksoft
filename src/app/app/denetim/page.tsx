import { batchAll } from "@/lib/supabase/query-batch";
import Link from "@/components/ui/smart-link";
import {
  Activity,
  ArrowUpRight,
  Fingerprint,
  FolderArchive,
  ScrollText,
  ShieldAlert,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import {
  actionLabel,
  HIGH_RISK_ACTIONS,
  riskOf,
  type RiskLevel,
} from "@/lib/audit-labels";
import {
  applyAuditFilters,
  auditFiltersToParams,
  hasAuditFilter,
  normalizeAuditFilters,
} from "@/lib/audit-filters";
import { daysAgoIso, now } from "@/lib/clock";

import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
// `logActivity` çağrılarında geçen TÜM aksiyon kodları (grep: action: "...").
// Haritada olmayan kod ham haliyle görünür — sessizce kaybolmaz.

/**
 * Risk sınıflandırması — aksiyon koduna göre.
 * Yüksek: geri alınamaz / veri kaybı / kimlik-yetki değişimi.
 * Orta: yapılandırma, devir ve erişim biçimini değiştiren işlemler.
 * Kalanı rutin operasyon (düşük).
 */
const riskChip: Record<Exclude<RiskLevel, "dusuk">, { label: string; cls: string }> = {
  yuksek: { label: "Yüksek risk", cls: "bg-danger-500/10 text-danger-500" },
  orta: { label: "Orta risk", cls: "bg-amber-400/15 text-amber-600" },
};

/*
 * entity_id → ilgili kayıt. Yalnızca panelde detay sayfası olan tipler
 * linklenir; bilinmeyen tip linksiz kalır (yanlış yere götürmekten iyidir).
 */
const ENTITY_ROUTES: Record<string, string> = {
  customer: "/app/musteriler",
  property: "/app/portfoyler",
  deal: "/app/anlasmalar",
};

function diffPreview(oldValue: unknown, newValue: unknown) {
  if (oldValue && newValue && typeof oldValue === "object" && typeof newValue === "object") {
    const o = oldValue as Record<string, unknown>;
    const n = newValue as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(o), ...Object.keys(n)])].slice(0, 4);
    const parts = keys
      .filter((k) => JSON.stringify(o[k]) !== JSON.stringify(n[k]))
      .map((k) => `${k}: ${JSON.stringify(o[k]) ?? "∅"} → ${JSON.stringify(n[k]) ?? "∅"}`);
    if (parts.length) return parts.join(" · ");
  }
  if (newValue) return JSON.stringify(newValue).slice(0, 96);
  if (oldValue) return JSON.stringify(oldValue).slice(0, 96);
  return "—";
}

const PAGE_SIZE = 60;

export default async function AuditPage({
  searchParams,
}: {
  searchParams?: Promise<{ sayfa?: string; from?: string; to?: string; aktor?: string; risk?: string; tur?: string; ara?: string }>;
}) {
  await requireModulePage("settings", "/app/denetim");
  const params = (await searchParams) ?? {};
  const filters = normalizeAuditFilters(params);
  const { from: fromF, to: toF, aktor: aktorF, risk: riskF, tur: turF, ara: araF } = filters;
  const pageParam = Math.max(1, Number.parseInt(params.sayfa ?? "1", 10) || 1);
  const offset = (pageParam - 1) * PAGE_SIZE;
  const hasFilter = hasAuditFilter(filters);

  const supabase = await createClient();
  // Sayfalama + tarih aralığı + aktör filtresi tamamen sunucu tarafında.
  // Denetim kaydında sessiz kırpma özellikle sakıncalı: "kayıt yok"
  // ile "kayıt var ama listede değil" arasındaki fark, denetimin
  // anlamını belirliyor — `count: "exact"` gerçek toplamı verir.
  let logQuery = supabase
    .from("audit_logs")
    .select(
      "id, action, entity_type, entity_id, actor_id, new_value, old_value, created_at",
      { count: "exact" },
    )
    .order("created_at", { ascending: false });
  // Tarih, aktör, risk, işlem türü ve metin araması sunucu tarafında (Rapor merkezi aynı süzgeci kullanır).
  logQuery = applyAuditFilters(logQuery, filters);
  const [{ data: logs, count: logTotal }, { count: highCount }, { count: last24Count }] = await batchAll("Denetim günlüğü", [], [
    logQuery.range(offset, offset + PAGE_SIZE - 1),
    // KPI'lar gerçek sayım: sayfadaki 60 kayıt değil, tüm günlük.
    supabase.from("audit_logs").select("id", { count: "exact", head: true }).in("action", [...HIGH_RISK_ACTIONS]),
    supabase.from("audit_logs").select("id", { count: "exact", head: true }).gte("created_at", daysAgoIso(1)),
  ]);

  const total = logTotal ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(pageParam, totalPages);

  const rows = logs ?? [];
  // Seçili aktör sayfada geçmese bile adı çözülsün diye listeye eklenir.
  const actorIds = [...new Set([...rows.map((r) => r.actor_id), aktorF || null].filter(Boolean))] as string[];
  const actorNames = new Map<string, string>();
  if (actorIds.length) {
    const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", actorIds);
    for (const p of profiles ?? []) actorNames.set(p.id, p.full_name);
  }
  // Aktör filtresi seçenekleri — sayfada geçen aktörlerden
  const actorOptions = actorIds
    .map((id) => ({ id, name: actorNames.get(id) ?? id.slice(0, 8) }))
    .sort((a, b) => a.name.localeCompare(b.name, "tr-TR"));

  /** Filtreleri koruyarak sayfa linki üretir. */
  const pageHref = (sayfa: number) => {
    const sp = auditFiltersToParams(filters, sayfa);
    const qs = sp.toString();
    return qs ? `/app/denetim?${qs}` : "/app/denetim";
  };

  const buckets = Array.from({ length: 12 }, () => 0);
  const nowMs = now();
  rows.forEach((r) => {
    const hours = Math.floor((nowMs - new Date(r.created_at).getTime()) / (2 * 3600_000));
    if (hours >= 0 && hours < 12) buckets[11 - hours] += 1;
  });
  const maxB = Math.max(1, ...buckets);

  // Zaman çizelgesi görünümü — kayıtlar gün başlıklarıyla gruplanır.
  const dayFmt = new Intl.DateTimeFormat("tr-TR", { dateStyle: "full" });
  const dayGroups: Array<{ day: string; items: typeof rows }> = [];
  for (const r of rows) {
    const day = dayFmt.format(new Date(r.created_at));
    const last = dayGroups[dayGroups.length - 1];
    if (last && last.day === day) last.items.push(r);
    else dayGroups.push({ day, items: [r] });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Denetim kayıtları"
        eyebrow="KVKK / denetim izi"
        description="Kim, ne zaman, neyi değiştirdi? Yapılan işlemlerin değiştirilemeyen kayıt defteri."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {/* Belge Merkezi aynı modül kapısı (settings) arkasında; KVKK incelemesinde denetim iziyle birlikte kullanılır. */}
            <Link
              href="/app/belgeler"
              className="focus-ring press inline-flex min-h-10 items-center gap-1.5 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-sm font-semibold text-ink-900 transition hover:border-brand-300"
            >
              <FolderArchive className="h-4 w-4 text-brand-600" /> Belge merkezi
            </Link>
            <Link
              href="/app/ofis-kontrol"
              className="focus-ring press inline-flex min-h-10 items-center gap-1.5 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-sm font-semibold text-ink-900 transition hover:border-brand-300"
            >
              <ShieldAlert className="h-4 w-4 text-brand-600" /> Ofis Kontrol
            </Link>
          </div>
        }
      />

      <section className="theme-dark grid gap-3 rounded-[var(--radius-panel)] bg-[image:var(--grad-ink)] p-3 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        <div className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.04] p-4">
          <p className="text-xs font-semibold text-white/70">Aktivite · son 24 saat (2 saatlik dilim)</p>
          <div className="mt-4 flex h-24 items-end gap-1.5">
            {buckets.map((b, i) => (
              <div
                key={i}
                className="bar-live flex-1 rounded-t-[4px] bg-gradient-to-t from-amber-500/80 to-amber-300"
                style={{ height: `${Math.max(8, (b / maxB) * 100)}%`, animationDelay: `${i * 40}ms` }}
              />
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: hasFilter ? "Filtre sonucu" : "Toplam kayıt", value: total, icon: ScrollText, href: "/app/denetim", tone: "text-amber-300" },
            { label: "Son 24 saat", value: last24Count ?? 0, icon: Activity, href: `/app/denetim?from=${daysAgoIso(1).slice(0, 10)}`, tone: "text-mint-400" },
            { label: "Yüksek riskli", value: highCount ?? 0, icon: ShieldAlert, href: "/app/denetim?risk=yuksek", tone: "text-danger-300" },
            { label: "Aktör", value: actorOptions.length, icon: Fingerprint, href: "#akis", tone: "text-cyan-400" },
          ].map((k) => (
            <a
              key={k.label}
              href={k.href}
              className="focus-ring press lift group flex flex-col justify-between rounded-[var(--radius-card)] border border-white/10 bg-white/5 p-3 transition hover:border-white/30"
            >
              <span className="flex items-start justify-between">
                <k.icon className={`h-4 w-4 ${k.tone}`} />
                <ArrowUpRight className="h-4 w-4 text-white/30 opacity-0 transition group-hover:text-white group-hover:opacity-100" />
              </span>
              <span>
                <span className="numeric mt-1 block font-display text-xl font-extrabold">{k.value}</span>
                <span className="block text-xs text-white/60">{k.label}</span>
              </span>
            </a>
          ))}
        </div>
      </section>

      <section id="akis" className="scroll-mt-24 overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface shadow-[var(--shadow-xs)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h2 className="font-display font-bold text-ink-950">Olay akışı</h2>
            <p className="text-xs text-text-muted">
              Zaman çizelgesi · aktör + değişiklik · ofis izole{totalPages > 1 ? ` · sayfa ${page}/${totalPages}` : ""}
            </p>
          </div>
        </div>
        {/* ?from=&to=&aktor= — sunucu tarafı filtre formu; submit sayfayı 1'e döndürür */}
        <form method="get" action="/app/denetim" className="flex flex-wrap items-center gap-2 border-b border-line bg-canvas/50 px-5 py-3">
          <span className="text-xs font-medium text-text-muted">Tarih:</span>
          <input
            name="from"
            type="date"
            defaultValue={fromF}
            aria-label="Başlangıç tarihi"
            className="rounded-[var(--radius-control)] border border-line bg-canvas px-2.5 py-1.5 text-sm outline-none focus:border-brand-400"
          />
          <span className="text-text-faint">—</span>
          <input
            name="to"
            type="date"
            defaultValue={toF}
            aria-label="Bitiş tarihi"
            className="rounded-[var(--radius-control)] border border-line bg-canvas px-2.5 py-1.5 text-sm outline-none focus:border-brand-400"
          />
          <select
            name="aktor"
            defaultValue={aktorF}
            aria-label="Aktör filtresi"
            className="rounded-[var(--radius-control)] border border-line bg-canvas px-2.5 py-1.5 text-sm outline-none focus:border-brand-400"
          >
            <option value="">Tüm aktörler</option>
            {actorOptions.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          <select
            name="risk"
            defaultValue={riskF}
            aria-label="Risk filtresi"
            className="rounded-[var(--radius-control)] border border-line bg-canvas px-2.5 py-1.5 text-sm outline-none focus:border-brand-400"
          >
            <option value="">Tüm riskler</option>
            <option value="yuksek">Yüksek risk</option>
            <option value="orta">Orta risk</option>
          </select>
          <select
            name="tur"
            defaultValue={turF}
            aria-label="İşlem türü"
            className="rounded-[var(--radius-control)] border border-line bg-canvas px-2.5 py-1.5 text-sm outline-none focus:border-brand-400"
          >
            <option value="">Tüm işlemler</option>
            {Object.entries(actionLabel)
              .sort((a, b) => a[1].localeCompare(b[1], "tr-TR"))
              .map(([code, label]) => (
                <option key={code} value={code}>{label}</option>
              ))}
          </select>
          <input
            name="ara"
            type="search"
            defaultValue={araF}
            placeholder="İşlem veya kayıt türü ara"
            aria-label="Metin ara"
            className="min-w-44 rounded-[var(--radius-control)] border border-line bg-canvas px-2.5 py-1.5 text-sm outline-none focus:border-brand-400"
          />
          <button type="submit" className="focus-ring press rounded-[var(--radius-control)] bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700">
            Filtrele
          </button>
          {hasFilter ? (
            <Link href="/app/denetim" className="text-xs font-semibold text-text-muted underline-offset-2 hover:text-danger-500 hover:underline">
              Temizle
            </Link>
          ) : null}
        </form>
        {rows.length === 0 ? (
          <div className="px-6 py-10">
            <EmptyState
              variant="compact"
              bare
              icon={ScrollText}
              title={total > 0 ? "Bu sayfada kayıt yok" : hasFilter ? "Süzgece uyan denetim kaydı yok" : "Henüz denetim kaydı yok"}
              description={
                total > 0
                  ? "Sayfa numarası aralık dışında; ilk sayfaya dönün."
                  : hasFilter
                    ? "Tarih aralığını genişletin ya da aktör, risk veya işlem türü süzgecini kaldırın."
                    : "Ofisteki ilk yazma işlemi (kayıt, düzenleme, silme, dışa aktarma) burada kim/ne zaman bilgisiyle görünür."
              }
              action={
                total > 0
                  ? { href: pageHref(1), label: "İlk sayfaya dön" }
                  : hasFilter
                    ? { href: "/app/denetim", label: "Filtreleri temizle" }
                    : { href: "/app/ofis-kontrol", label: "Ofis Kontrol Merkezi" }
              }
            />
          </div>
        ) : (
          <div>
            {dayGroups.map((g) => (
              <div key={g.day}>
                <p className="border-y border-line bg-canvas/60 px-5 py-1.5 text-xs font-bold uppercase tracking-[0.08em] text-text-faint">
                  {g.day}
                </p>
                <div className="divide-y divide-line">
            {g.items.map((r) => {
              const entityRoute = r.entity_type ? ENTITY_ROUTES[r.entity_type] : undefined;
              const entityLine = `${r.entity_type ?? "—"}${r.entity_id ? ` · ${String(r.entity_id).slice(0, 8)}…` : ""}`;
              const risk = riskOf(r.action);
              // Aktör linki yalnızca ofis profili çözüldüyse: platform
              // personeli /app/ekip altında yok, 404'e link vermeyelim.
              const actorName = r.actor_id ? actorNames.get(r.actor_id) : undefined;
              return (
                <article key={r.id} className="grid gap-2 px-5 py-3.5 transition hover:bg-brand-600/[0.02] md:grid-cols-[1.1fr_1.2fr_.7fr_auto] md:items-center">
                  <div>
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink-950">
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${
                          risk === "yuksek" ? "bg-danger-500" : risk === "orta" ? "bg-amber-400" : "bg-mint-500"
                        }`}
                        aria-hidden
                      />
                      {actionLabel[r.action] ?? r.action}
                      {risk !== "dusuk" ? (
                        <Link
                          href={`/app/denetim?risk=${risk}`}
                          title="Bu risk seviyesine göre filtrele"
                          className={`rounded-full px-2 py-0.5 text-xs font-bold transition hover:ring-1 hover:ring-brand-300 ${riskChip[risk].cls}`}
                        >
                          {riskChip[risk].label}
                        </Link>
                      ) : null}
                    </p>
                    {entityRoute && r.entity_id ? (
                      <Link
                        href={`${entityRoute}/${r.entity_id}`}
                        className="focus-ring group mt-0.5 inline-flex items-center gap-1 text-xs text-text-muted transition hover:text-brand-600"
                      >
                        {entityLine}
                        <ArrowUpRight className="hover-action h-3 w-3 opacity-0 transition group-hover:opacity-100" />
                      </Link>
                    ) : (
                      <p className="mt-0.5 text-xs text-text-muted">{entityLine}</p>
                    )}
                  </div>
                  {r.old_value || r.new_value ? (
                    <details className="group min-w-0 text-xs text-text-muted">
                      <summary className="cursor-pointer list-none truncate hover:text-brand-600">
                        {diffPreview(r.old_value, r.new_value)}
                      </summary>
                      <div className="mt-2 grid gap-2 rounded-[var(--radius-control)] border border-line bg-canvas/60 p-2.5 sm:grid-cols-2">
                        <div>
                          <p className="mb-1 font-bold uppercase tracking-[0.06em] text-text-faint">Önce</p>
                          <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words text-xs">{r.old_value ? JSON.stringify(r.old_value, null, 2) : "—"}</pre>
                        </div>
                        <div>
                          <p className="mb-1 font-bold uppercase tracking-[0.06em] text-text-faint">Sonra</p>
                          <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words text-xs">{r.new_value ? JSON.stringify(r.new_value, null, 2) : "—"}</pre>
                        </div>
                      </div>
                    </details>
                  ) : (
                    <p className="text-xs text-text-muted">—</p>
                  )}
                  {actorName && r.actor_id ? (
                    <Link
                      href={`/app/ekip/${r.actor_id}`}
                      className="focus-ring text-xs font-semibold text-ink-950 transition hover:text-brand-600 hover:underline"
                    >
                      {actorName}
                    </Link>
                  ) : (
                    <p className="text-xs font-semibold text-ink-950">
                      {r.actor_id ? r.actor_id.slice(0, 8) : "Sistem"}
                    </p>
                  )}
                  <time className="text-xs font-semibold text-text-muted tabular-nums">
                    {new Intl.DateTimeFormat("tr-TR", { timeStyle: "short" }).format(new Date(r.created_at))}
                  </time>
                </article>
              );
            })}
                </div>
              </div>
            ))}
          </div>
        )}
        {totalPages > 1 ? (
          <nav aria-label="Sayfalama" className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
            {page > 1 ? (
              <Link href={pageHref(page - 1)} className="focus-ring press rounded-[var(--radius-control)] border border-line px-3 py-1.5 text-xs font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600">
                ← Önceki
              </Link>
            ) : (
              <span className="rounded-[var(--radius-control)] border border-line px-3 py-1.5 text-xs font-semibold text-text-faint opacity-50">← Önceki</span>
            )}
            <span className="text-xs tabular-nums text-text-muted">
              Sayfa {page} / {totalPages} · toplam {total.toLocaleString("tr-TR")} kayıt
            </span>
            {page < totalPages ? (
              <Link href={pageHref(page + 1)} className="focus-ring press rounded-[var(--radius-control)] border border-line px-3 py-1.5 text-xs font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600">
                Sonraki →
              </Link>
            ) : (
              <span className="rounded-[var(--radius-control)] border border-line px-3 py-1.5 text-xs font-semibold text-text-faint opacity-50">Sonraki →</span>
            )}
          </nav>
        ) : null}
      </section>
    </div>
  );
}
