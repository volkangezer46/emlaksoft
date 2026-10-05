import Link from "next/link";
import { Inbox } from "lucide-react";
import { requirePlatformModule } from "@/lib/platform";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPathLabel, listChangeRequests } from "@/lib/geo/admin-store";
import { formatDateTimeTr } from "@/lib/format";
import { ResolveForm } from "./resolve-form";

const STATUS_LABEL: Record<string, string> = { pending: "Bekliyor", approved: "Onaylandı", rejected: "Reddedildi" };

export default async function AdminGeoRequestsPage({ searchParams }: { searchParams: Promise<{ durum?: string }> }) {
  const staff = await requirePlatformModule("geo");
  const canWrite = staff.role === "super_admin";
  const { durum } = await searchParams;
  const filter = durum === "onaylandi" ? "approved" : durum === "reddedildi" ? "rejected" : durum === "hepsi" ? "all" : "pending";
  const requests = await listChangeRequests(filter);

  // Ofis konumunu okunur yola çevir ve "ekle" bağlantısı için ilçe sayfasını bul.
  const withPath = requests
    ? await Promise.all(requests.map(async (r) => {
        const level = r.neighborhoodId ? "neighborhood" : r.districtId ? "district" : "province";
        const id = r.neighborhoodId ?? r.districtId ?? r.provinceId;
        const path = id ? await getPathLabel(level, id) : "";
        const href = r.districtId && r.provinceId ? `/admin/geo/${r.provinceId}/${r.districtId}` : r.provinceId ? `/admin/geo/${r.provinceId}` : "/admin/geo";
        return { ...r, path, href };
      }))
    : null;

  const admin = createAdminClient();
  const { data: suggestions } = await admin
    .from("platform_audit_logs")
    .select("id, entity_id, entity_type, meta, created_at")
    .eq("action", "geo.suggestion")
    .order("created_at", { ascending: false })
    .limit(30);

  return (
    <div className="space-y-6">
      <header>
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-amber-600"><Inbox className="h-3.5 w-3.5" /> Bildirim kuyruğu</p>
        <h1 className="mt-1 font-display text-2xl font-extrabold">Eksik / yanlış bölge bildirimleri</h1>
        <p className="mt-1 max-w-2xl text-sm text-text-muted">Ofis sahiplerinin bildirdiği eksik ya da yanlış mahalleler ve operasyon ekibinin düzeltme önerileri. Onaylanan kaydı Gezgin&apos;den ekleyip düzeltin.</p>
      </header>

      <nav aria-label="Durum" className="flex gap-1 text-xs font-semibold">
        {[["", "Bekleyen"], ["onaylandi", "Onaylanan"], ["reddedildi", "Reddedilen"], ["hepsi", "Hepsi"]].map(([v, label]) => (
          <Link key={v || "bekleyen"} href={v ? `/admin/geo/bildirimler?durum=${v}` : "/admin/geo/bildirimler"} className={`rounded-full border px-2.5 py-1 ${(durum ?? "") === v ? "border-brand-400 text-brand-600" : "border-line text-text-muted"}`}>{label}</Link>
        ))}
      </nav>

      {withPath === null ? (
        <p className="rounded-[var(--radius-card)] border border-amber-300/50 bg-amber-500/[0.06] px-4 py-3 text-sm text-amber-800">Ofis bildirimi altyapısı bu ortamda etkin değil (geo yönetim migration&apos;ı uygulanmamış).</p>
      ) : withPath.length === 0 ? (
        <p className="rounded-[var(--radius-card)] border border-line bg-surface px-4 py-10 text-center text-sm text-text-muted">Bu durumda bildirim yok.</p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface">
          {withPath.map((r) => (
            <li key={r.id} className="space-y-2 px-5 py-4">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="rounded-full bg-canvas px-2 py-0.5 text-xs font-bold text-text-muted">{r.kind === "missing" ? "Eksik" : "Yanlış"}</span>
                <b>{r.proposedName}</b>
                <span className="text-xs text-text-muted">{r.path || "Konum belirtilmemiş"}</span>
                <Link href={`/admin/tenants/${r.tenantId}`} className="text-xs font-semibold text-brand-600 hover:underline">{r.tenantName ?? "Ofis"}</Link>
                <span className="ml-auto text-xs text-text-muted">{formatDateTimeTr(r.createdAt)} · {STATUS_LABEL[r.status] ?? r.status}</span>
              </div>
              {r.note ? <p className="text-sm text-text-muted">{r.note}</p> : null}
              {r.resolutionNote ? <p className="text-xs text-text-muted">Karar notu: {r.resolutionNote}</p> : null}
              <Link href={r.href} className="inline-block text-xs font-semibold text-brand-600 hover:underline">Gezgin&apos;de aç</Link>
              {canWrite && r.status === "pending" ? <ResolveForm id={r.id} /> : null}
            </li>
          ))}
        </ul>
      )}

      <section className="space-y-2">
        <h2 className="font-display text-lg font-bold">Operasyon düzeltme önerileri</h2>
        {(suggestions ?? []).length === 0 ? (
          <p className="text-sm text-text-muted">Öneri yok.</p>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface text-sm">
            {(suggestions ?? []).map((s) => {
              const meta = (s.meta ?? {}) as { level?: string; note?: string; by?: string };
              return (
                <li key={s.id} className="flex flex-wrap items-center gap-2 px-5 py-3">
                  <span className="rounded-full bg-canvas px-2 py-0.5 text-xs font-bold text-text-muted">{meta.level ?? s.entity_type}</span>
                  <span>{meta.note}</span>
                  <span className="ml-auto text-xs text-text-muted">{meta.by ?? "—"} · {formatDateTimeTr(s.created_at)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
