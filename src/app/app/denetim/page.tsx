import Link from "next/link";
import {
  Activity,
  ArrowUpRight,
  Fingerprint,
  ScrollText,
  Shield,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { exportAuditCsv } from "@/app/actions/export";
import { ExportCsvButton } from "@/components/app/export-csv-button";
import { DAY_MS, msSince, now } from "@/lib/clock";

// `logActivity` çağrılarında geçen TÜM aksiyon kodları (grep: action: "...").
// Haritada olmayan kod ham haliyle görünür — sessizce kaybolmaz.
const actionLabel: Record<string, string> = {
  "workflow.deal_won": "Satış kapandı",
  "commission.paid": "Komisyon tahsil",
  "commission.from_pipeline": "Satış hattı komisyonu",
  "deal.create": "Anlaşma oluşturuldu",
  "deal.stage": "Anlaşma aşaması",
  "deal.update": "Anlaşma güncellendi",
  "payment_link.create": "Ödeme linki",
  "share.create": "Paylaşım linki",
  "ops.impersonate.start": "Ofis önizleme başladı",
  "ops.impersonate.stop": "Ofis önizleme bitti",
  "customer.create": "Müşteri eklendi",
  "customer.update": "Müşteri güncellendi",
  "customer.delete": "Müşteri silindi",
  "customer.reassign": "Müşteri devri",
  "customer_file.upload": "Müşteri dosyası yüklendi",
  "customer_file.delete": "Müşteri dosyası silindi",
  "match.save": "Eşleştirme kaydı",
  "demo.request": "Demo talebi",
  "demand.create": "Talep oluşturuldu",
  "demand.update": "Talep güncellendi",
  "property.create": "Portföy oluşturuldu",
  "property.update": "Portföy güncellendi",
  "property.status": "Portföy durumu değişti",
  "property.delete": "Portföy silindi",
  "property.reassign": "Portföy devri",
  "property.bulk_status": "Toplu portföy durumu",
  "property_media.upload": "Portföy medyası yüklendi",
  "valuation.create": "Değerleme oluşturuldu",
  "iys.upsert": "İYS izin kaydı",
  "task.create": "Görev oluşturuldu",
  "task.update": "Görev güncellendi",
  "task.complete": "Görev tamamlandı",
  "call.create": "Arama kaydı",
  "appointment.create": "Randevu oluşturuldu",
  "appointment.update": "Randevu güncellendi",
  "settings.update": "Ayarlar güncellendi",
  "portal.close": "Portal ilanı kapatıldı",
  "lead.capture.toggle": "Lead formu aç/kapat",
  "lead.capture.regenerate_token": "Lead form bağlantısı yenilendi",
  "kvkk.erasure": "KVKK silme talebi",
  "kvkk.purge": "KVKK verisi imha edildi",
  "integration.endeksa.save": "Endeksa entegrasyonu kaydedildi",
  "integration.endeksa.clear": "Endeksa entegrasyonu kaldırıldı",
  "integration.tapusor.save": "TapuSor entegrasyonu kaydedildi",
  "integration.tapusor.clear": "TapuSor entegrasyonu kaldırıldı",
  "platform_staff.add": "Platform ekibine eklendi",
  "platform_staff.invite": "Platform ekip daveti",
  "platform_staff.role_change": "Platform rol değişikliği",
  "platform_staff.deactivate": "Platform üyesi pasifleştirildi",
  "platform_staff.reactivate": "Platform üyesi aktifleştirildi",
  "sales.status": "Satış kaydı durumu",
  "sales.assign": "Satış kaydı ataması",
  "sales.convert": "Satış kaydı dönüştürüldü",
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

/** YYYY-MM-DD biçimindeyse döndür, aksi halde boş — sorguya ham girdi gitmesin. */
function safeDate(value: string | undefined) {
  const v = (value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "";
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams?: Promise<{ sayfa?: string; from?: string; to?: string; aktor?: string }>;
}) {
  await requireModulePage("settings");
  const params = (await searchParams) ?? {};
  const fromF = safeDate(params.from);
  const toF = safeDate(params.to);
  const aktorF = (params.aktor ?? "").trim();
  const pageParam = Math.max(1, Number.parseInt(params.sayfa ?? "1", 10) || 1);
  const offset = (pageParam - 1) * PAGE_SIZE;
  const hasFilter = Boolean(fromF || toF || aktorF);

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
  if (fromF) logQuery = logQuery.gte("created_at", fromF);
  if (toF) logQuery = logQuery.lte("created_at", `${toF}T23:59:59.999`);
  if (aktorF) logQuery = logQuery.eq("actor_id", aktorF);
  const { data: logs, count: logTotal } = await logQuery.range(offset, offset + PAGE_SIZE - 1);

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
    const sp = new URLSearchParams();
    if (fromF) sp.set("from", fromF);
    if (toF) sp.set("to", toF);
    if (aktorF) sp.set("aktor", aktorF);
    if (sayfa > 1) sp.set("sayfa", String(sayfa));
    const qs = sp.toString();
    return qs ? `/app/denetim?${qs}` : "/app/denetim";
  };

  const today = rows.filter((r) => msSince(r.created_at) < DAY_MS).length;

  const buckets = Array.from({ length: 12 }, () => 0);
  const nowMs = now();
  rows.forEach((r) => {
    const hours = Math.floor((nowMs - new Date(r.created_at).getTime()) / (2 * 3600_000));
    if (hours >= 0 && hours < 12) buckets[11 - hours] += 1;
  });
  const maxB = Math.max(1, ...buckets);

  return (
    <div className="space-y-6">
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -left-10 bottom-0 h-48 w-48 rounded-full bg-danger-500/20 blur-[80px]" />
        <div className="relative grid gap-6 lg:grid-cols-[1.2fr_1fr] lg:items-center">
          <div>
            <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-danger-300">
              <Shield className="h-3.5 w-3.5" /> KVKK / denetim izi
            </p>
            <h1 className="mt-2 font-display text-3xl font-extrabold">Denetim kayıtları</h1>
            <p className="mt-2 max-w-lg text-sm text-white/60">
              Yazma işlemlerinin immutable günlüğü. Sahte aktivite yok — yalnızca `logActivity` kayıtları.
            </p>
            <div className="mt-5 grid grid-cols-3 gap-3">
              {[
                { label: hasFilter ? "Filtre sonucu" : "Toplam kayıt", value: total, icon: ScrollText },
                { label: "Sayfada son 24s", value: today, icon: Activity },
                { label: "Aktör", value: actorOptions.length, icon: Fingerprint },
              ].map((k) => (
                <div key={k.label} className="rounded-[14px] border border-white/10 bg-white/5 p-3">
                  <k.icon className="h-4 w-4 text-amber-300" />
                  <p className="mt-1 font-display text-xl font-extrabold">{k.value}</p>
                  <p className="text-[11px] text-white/45">{k.label}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-[16px] border border-white/10 bg-white/[0.04] p-4">
            <p className="text-xs font-semibold text-white/70">Aktivite · son 24 saat (2s dilim)</p>
            <div className="mt-4 flex h-28 items-end gap-1.5">
              {buckets.map((b, i) => (
                <div
                  key={i}
                  className="bar-live flex-1 rounded-t-[4px] bg-gradient-to-t from-amber-500/80 to-amber-300"
                  style={{ height: `${Math.max(8, (b / maxB) * 100)}%`, animationDelay: `${i * 40}ms` }}
                />
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-[20px] border border-line bg-surface shadow-[var(--shadow-xs)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h2 className="font-display font-bold text-ink-950">Olay akışı</h2>
            <p className="text-xs text-text-muted">
              Aktör + değişiklik · ofis izole{totalPages > 1 ? ` · sayfa ${page}/${totalPages}` : ""}
            </p>
          </div>
          <ExportCsvButton label="CSV dışa aktar" action={exportAuditCsv} />
        </div>
        {/* ?from=&to=&aktor= — sunucu tarafı filtre formu; submit sayfayı 1'e döndürür */}
        <form method="get" action="/app/denetim" className="flex flex-wrap items-center gap-2 border-b border-line bg-canvas/50 px-5 py-3">
          <span className="text-xs font-medium text-text-muted">Tarih:</span>
          <input
            name="from"
            type="date"
            defaultValue={fromF}
            aria-label="Başlangıç tarihi"
            className="rounded-[9px] border border-line bg-canvas px-2.5 py-1.5 text-sm outline-none focus:border-brand-400"
          />
          <span className="text-text-faint">—</span>
          <input
            name="to"
            type="date"
            defaultValue={toF}
            aria-label="Bitiş tarihi"
            className="rounded-[9px] border border-line bg-canvas px-2.5 py-1.5 text-sm outline-none focus:border-brand-400"
          />
          <select
            name="aktor"
            defaultValue={aktorF}
            aria-label="Aktör filtresi"
            className="rounded-[9px] border border-line bg-canvas px-2.5 py-1.5 text-sm outline-none focus:border-brand-400"
          >
            <option value="">Tüm aktörler</option>
            {actorOptions.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          <button type="submit" className="focus-ring press rounded-[9px] bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700">
            Filtrele
          </button>
          {hasFilter ? (
            <Link href="/app/denetim" className="text-xs font-semibold text-text-muted underline-offset-2 hover:text-danger-500 hover:underline">
              Temizle
            </Link>
          ) : null}
        </form>
        {rows.length === 0 ? (
          <div className="grid place-items-center px-6 py-16 text-center">
            <ScrollText className="h-8 w-8 text-text-faint" />
            <p className="mt-3 text-sm text-text-muted">
              {total > 0
                ? "Bu sayfada kayıt yok — sayfa numarası aralık dışında."
                : hasFilter
                  ? "Filtreye uyan denetim kaydı yok."
                  : "Henüz denetim kaydı yok. İlk yazma işlemi burada görünecek."}
            </p>
            {total > 0 ? (
              <Link href={pageHref(1)} className="mt-1 text-sm font-semibold text-brand-600 hover:underline">
                İlk sayfaya dön
              </Link>
            ) : hasFilter ? (
              <Link href="/app/denetim" className="mt-1 text-sm font-semibold text-brand-600 hover:underline">
                Filtreleri temizle
              </Link>
            ) : null}
          </div>
        ) : (
          <div className="divide-y divide-line">
            {rows.map((r) => {
              const entityRoute = r.entity_type ? ENTITY_ROUTES[r.entity_type] : undefined;
              const entityLine = `${r.entity_type ?? "—"}${r.entity_id ? ` · ${String(r.entity_id).slice(0, 8)}…` : ""}`;
              // Aktör linki yalnızca ofis profili çözüldüyse: platform
              // personeli /app/ekip altında yok, 404'e link vermeyelim.
              const actorName = r.actor_id ? actorNames.get(r.actor_id) : undefined;
              return (
                <article key={r.id} className="grid gap-2 px-5 py-3.5 transition hover:bg-brand-600/[0.02] md:grid-cols-[1.1fr_1.2fr_.7fr_auto] md:items-center">
                  <div>
                    <p className="text-sm font-semibold text-ink-950">
                      {actionLabel[r.action] ?? r.action}
                    </p>
                    {entityRoute && r.entity_id ? (
                      <Link
                        href={`${entityRoute}/${r.entity_id}`}
                        className="focus-ring group mt-0.5 inline-flex items-center gap-1 text-[11px] text-text-muted transition hover:text-brand-600"
                      >
                        {entityLine}
                        <ArrowUpRight className="hover-action h-3 w-3 opacity-0 transition group-hover:opacity-100" />
                      </Link>
                    ) : (
                      <p className="mt-0.5 text-[11px] text-text-muted">{entityLine}</p>
                    )}
                  </div>
                  <p className="truncate text-[11px] text-text-muted" title={diffPreview(r.old_value, r.new_value)}>
                    {diffPreview(r.old_value, r.new_value)}
                  </p>
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
                    {new Intl.DateTimeFormat("tr-TR", { dateStyle: "short", timeStyle: "short" }).format(new Date(r.created_at))}
                  </time>
                </article>
              );
            })}
          </div>
        )}
        {totalPages > 1 ? (
          <nav aria-label="Sayfalama" className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
            {page > 1 ? (
              <Link href={pageHref(page - 1)} className="focus-ring press rounded-[9px] border border-line px-3 py-1.5 text-xs font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600">
                ← Önceki
              </Link>
            ) : (
              <span className="rounded-[9px] border border-line px-3 py-1.5 text-xs font-semibold text-text-faint opacity-50">← Önceki</span>
            )}
            <span className="text-xs tabular-nums text-text-muted">
              Sayfa {page} / {totalPages} · toplam {total.toLocaleString("tr-TR")} kayıt
            </span>
            {page < totalPages ? (
              <Link href={pageHref(page + 1)} className="focus-ring press rounded-[9px] border border-line px-3 py-1.5 text-xs font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600">
                Sonraki →
              </Link>
            ) : (
              <span className="rounded-[9px] border border-line px-3 py-1.5 text-xs font-semibold text-text-faint opacity-50">Sonraki →</span>
            )}
          </nav>
        ) : null}
      </section>
    </div>
  );
}
