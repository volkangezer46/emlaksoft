import Link from "@/components/ui/smart-link";
import { Sparkles, ThumbsUp } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { FilterChip } from "@/components/ui/filter-chip";
import { RegistrySettings } from "@/components/settings/registry-settings";
import { Pagination, pageRange, parsePage } from "@/app/admin/_components/pagination";
import { requirePlatformModule } from "@/lib/platform";
import { platformModuleMode } from "@/lib/platform-access";
import { isRequestStatus, REQUEST_STATUS_LABEL, REQUEST_STATUSES, type RequestStatus } from "@/lib/product-feedback/model";
import { countRequestsByStatus, listRecentChangelogEntries, listRequestsForAdmin } from "@/lib/product-feedback/store";
import { FEEDBACK_SETTING_KEYS } from "@/lib/settings/registry/feedback";
import { RequestStatusForm } from "./request-status-form";

export const metadata = { title: "Öneri panosu" };

const BASE = "/admin/tickets/oneriler";
const fmt = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeZone: "Europe/Istanbul" });
const STATUS_OPTIONS = REQUEST_STATUSES.map((s) => ({ value: s, label: REQUEST_STATUS_LABEL[s] }));

/**
 * Özellik istek panosu (DG8, admin): ofislerin önerileri oy sayısına göre; durum güncelleme (İnceleniyor → Oylamada →
 * Planlandı → Yapılıyor → Yayında; ya da "Şimdilik planda yok"). "İnceleniyor" öneriler yalnız öneren ofise görünür:
 * "Oylamada"ya alınca tüm ofisler görür ve oy verir (ofis başına tek oy). Durum değişince önerene, Planlandı/Yapılıyor/
 * Yayında'da oy veren tüm ofislere bildirim gider; "Yayında" öneri bir yenilik girdisine bağlanır (PA-10).
 */
export default async function FeatureRequestsAdminPage({ searchParams }: { searchParams: Promise<{ durum?: string; sayfa?: string }> }) {
  const staff = await requirePlatformModule("tickets");
  const canEdit = platformModuleMode(staff.role, "tickets") === "write";
  const sp = await searchParams;
  const status: RequestStatus | null = isRequestStatus(sp.durum) ? sp.durum : null;
  const page = parsePage(sp.sayfa);
  const [from, to] = pageRange(page);
  const [list, counts, changelog] = await Promise.all([
    listRequestsForAdmin({ status, from, to }),
    countRequestsByStatus().catch(() => ({}) as Record<string, number>),
    canEdit ? listRecentChangelogEntries().catch(() => []) : Promise.resolve([]),
  ]);
  const changelogOptions = changelog.map((c) => ({ id: c.id, label: `${fmt.format(new Date(c.publishedAt))} · ${c.title}` }));
  const all = Object.values(counts).reduce((a, b) => a + b, 0);
  const hrefFor = (s: RequestStatus | null, p = 1) => {
    const q = new URLSearchParams();
    if (s) q.set("durum", s);
    if (p > 1) q.set("sayfa", String(p));
    const qs = q.toString();
    return qs ? `${BASE}?${qs}` : BASE;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Destek"
        title="Öneri panosu"
        description="Ofislerin özellik önerileri ve oyları (ofis başına tek oy). Yeni öneriler önce yalnız öneren ofise görünür; 'Oylamada'ya aldığınızda tüm ofisler görür. Durum değişince önerene; Planlandı, Yapılıyor ve Yayında'da oy veren tüm ofislere bildirim gider."
        breadcrumbs={[{ label: "Destek talepleri", href: "/admin/tickets" }, { label: "Öneri panosu" }]}
      />
      {!list.ready ? (
        <p className="rounded-[var(--radius-panel)] border border-amber-400/30 bg-amber-400/8 px-5 py-6 text-sm text-amber-700">
          Kurulum bekliyor: öneri panosu tabloları veritabanı güncellemesiyle (20261014008000) gelir.
        </p>
      ) : (
        <>
          <nav aria-label="Durum süzgeci" className="flex flex-wrap gap-2">
            <FilterChip href={hrefFor(null)} active={!status} count={all}>
              Tümü
            </FilterChip>
            {REQUEST_STATUSES.map((s) => (
              <FilterChip key={s} href={hrefFor(s)} active={status === s} count={counts[s] ?? 0}>
                {REQUEST_STATUS_LABEL[s]}
              </FilterChip>
            ))}
          </nav>
          <section className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface">
            {list.rows.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-text-muted">
                {status ? "Bu durumda öneri yok." : "Henüz öneri yok. Ofisler Yardım > Öneri panosu'ndan öneri yazdıkça burada görünür."}
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {list.rows.map((r) => (
                  <li key={r.id} className="space-y-2 px-5 py-4">
                    <div className="flex flex-wrap items-start gap-3">
                      <span className="inline-flex min-w-12 flex-col items-center rounded-[var(--radius-control)] border border-line bg-canvas px-2 py-1" title="Oy veren ofis sayısı">
                        <ThumbsUp className="h-3.5 w-3.5 text-brand-600" aria-hidden />
                        <span className="numeric text-sm font-bold text-ink-950">{r.voteCount}</span>
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-ink-950">{r.title}</p>
                        {r.body ? <p className="mt-0.5 whitespace-pre-line text-xs text-text-muted">{r.body}</p> : null}
                        <p className="mt-1 text-xs text-text-faint">
                          <Link href={`/admin/tenants/${r.tenantId}`} className="hover:text-brand-600">
                            {r.tenantName ?? "Ofis"}
                          </Link>{" "}
                          · {fmt.format(new Date(r.createdAt))} ·{" "}
                          <Link href={hrefFor(r.status)} className="hover:text-brand-600">
                            {REQUEST_STATUS_LABEL[r.status]}
                          </Link>
                        </p>
                        {r.changelogTitle ? (
                          <p className="mt-1 inline-flex items-center gap-1 text-xs text-text-muted">
                            <Sparkles className="h-3.5 w-3.5 text-brand-600" aria-hidden /> Yenilik: <Link href="/admin/duyuru?sekme=yenilikler" className="font-semibold text-accent-text hover:underline">{r.changelogTitle}</Link>
                          </p>
                        ) : null}
                      </div>
                    </div>
                    {canEdit ? (
                      <RequestStatusForm
                        id={r.id}
                        status={r.status}
                        note={r.adminNote ?? ""}
                        options={STATUS_OPTIONS}
                        voteCount={r.voteCount}
                        changelogId={r.changelogEntryId}
                        changelogOptions={changelogOptions}
                      />
                    ) : r.adminNote ? (
                      <p className="text-xs text-text-muted">Not: {r.adminNote}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            <div className="px-5 pb-4">
              <Pagination page={page} total={list.total} hrefFor={(p) => hrefFor(status, p)} />
            </div>
          </section>
        </>
      )}
      <RegistrySettings
        title="Pano ayarı"
        description="Panonun açık olup olmadığı. Ofis/plan/yüzde hedeflemesi Ayarlar > Özellik bayrakları ekranında."
        keys={[FEEDBACK_SETTING_KEYS.boardEnabled]}
        canEdit={staff.role === "super_admin"}
      />
    </div>
  );
}
