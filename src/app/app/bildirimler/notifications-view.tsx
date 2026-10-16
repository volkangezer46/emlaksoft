import { assertQueryBatchSucceeded, batchAll } from "@/lib/supabase/query-batch";
import { FilterChip } from "@/components/ui/filter-chip";
import { Button } from "@/components/ui/button";
import Link from "@/components/ui/smart-link";
import { ArrowUpRight, Bell, BellRing, Check, CheckCheck, Inbox } from "lucide-react";
import { canDecideApproval } from "@/lib/approvals";
import { OVERDUE_TASKS_HREF, overdueTasksCountQuery } from "@/lib/nav-badges";
import { isDecisionNotification } from "@/lib/notification-decision";
import { requireModulePage } from "@/lib/require-module-page";
import { createClient } from "@/lib/supabase/server";
import {
  completeTaskFromNotificationForm,
  markAllNotificationsReadForm,
  markNotificationReadForm,
} from "@/app/actions/notifications";
import { PushEnableCard } from "@/components/app/pwa-prompt-card";
import { isNotificationTopic, NOTIFICATION_TOPICS, TOPIC_LABEL, type NotificationTopic } from "@/lib/notification-topics";
import { daysAgoIso, now } from "@/lib/clock";
import { isMissingFunctionError, recordRpcOutcome, rpcKnownMissing } from "@/lib/supabase/rpc-probe";
import { notificationHref, notificationMarker, parseNotificationCounts, stripNotificationMarker, type NotificationCounts } from "@/lib/notification-text";
import { MarkReadForm } from "./mark-read-form";

import { PageHeader } from "@/components/ui/page-header";
import { IconChip } from "@/components/ui/icons/icon-chip";
import { groupNotifications, notificationTimeLabel } from "./group-notifications";
/**
 * Tenant bildirim arşivi — zil panelindeki son 30 kaydın sayfalı/filtreli tam
 * listesi. Sorgu mantığı zil ile aynı (bkz. listMyNotifications): RLS + kendi
 * user_id'si veya tenant-geneli (user_id IS NULL) bildirimler. Okunma durumu
 * KİŞİ BAŞINA `notification_reads`'ten (ortak bildirim herkese ayrı okunur);
 * sayaçlar zil ile AYNI kaynaktan: `my_notification_counts()` (tek RPC turu).
 *
 * Filtre kontratı: ?durum=okunmamis, ?konu=<randevu|gorev|…> (GA-08; konu migration'ı yoksa ?tur=<kind>), ?sayfa= — URL sorguya
 * yansır, çipler URL'i günceller (sunucu filtre + gerçek sayfalama).
 *
 * C22: istatistik kartı yok (okunma oranı vb. işe yaramıyordu). İlk bölüm "Sizden karar bekleyenler": canlı onay
 * kuyruğu + geciken görev (tek tanım `nav-badges`) ve okunmamış karar bildirimleri (zil rozetiyle aynı kural,
 * `notification-decision.ts`); ardından diğer bildirimler. Sade görünümde filtre çipleri "Filtreler" altında katlı.
 */

// Palet: Ink / Brand / Mint / Amber / Cyan — mor kullanılmaz.
const dotColor: Record<string, string> = {
  success: "bg-mint-500",
  info: "bg-brand-500",
  warning: "bg-amber-400",
  danger: "bg-danger-500",
  system: "bg-cyan-400",
};

const kindLabel: Record<string, string> = {
  success: "Başarılı",
  info: "Bilgi",
  warning: "Uyarı",
  danger: "Kritik",
  system: "Sistem",
};

const PAGE_SIZE = 50;

export async function NotificationsView({
  searchParams,
}: {
  searchParams?: Promise<{ durum?: string; tur?: string; konu?: string; sayfa?: string }>;
}) {
  const ctx = await requireModulePage("dashboard");
  const sp = (await searchParams) ?? {};
  const durum = sp.durum === "okunmamis" ? "okunmamis" : undefined;
  const tur = sp.tur && kindLabel[sp.tur] ? sp.tur : undefined;
  const konu: NotificationTopic | undefined = isNotificationTopic(sp.konu) ? sp.konu : undefined;
  const canCompleteTasks = (ctx.perms.tasks ?? []).includes("edit");
  const pageParam = Math.max(1, Number.parseInt(sp.sayfa ?? "1", 10) || 1);
  const offset = (pageParam - 1) * PAGE_SIZE;

  const supabase = await createClient();
  const { rows: data, total: count, counts } = await loadNotificationsPage(supabase, ctx.userId, { durum, tur, konu, offset });
  // Konu kırılımı yalnız migration 20261018050000 sonrası gelir; yoksa tür çiplerine düşülür.
  const topicCounts = counts.topics;

  const kindKeys = Object.keys(kindLabel);
  const kindCounts: Record<string, number> = {};
  for (const k of kindKeys) kindCounts[k] = counts.kinds[k] ?? 0;

  // Gövde sonundaki makine izi (` · task:<uuid>`) gösterilmez; izden kayda daha yakın bağlantı türetilir.
  const rows = (data ?? []).map((r) => {
    const marker = notificationMarker(r.body);
    // Eski kayıtlarda başlık başında süs simgesi (🔔) kalmış olabilir: liste sade metinle gösterilir.
    return { ...r, title: r.title.replace(/^\p{Extended_Pictographic}\uFE0F?\s*/u, ""), taskId: marker?.kind === "task" ? marker.id : null, body: stripNotificationMarker(r.body), href: notificationHref(r) };
  });
  // Satır içi "Tamamla": yalnız hâlâ AÇIK görevler (tek sorgu; RLS kapsamı geçerli).
  const taskIds = canCompleteTasks ? [...new Set(rows.map((r) => r.taskId).filter((v): v is string => Boolean(v)))] : [];
  const openTasks = new Set<string>();
  if (taskIds.length > 0) {
    const { data: open } = await supabase.from("tasks").select("id").in("id", taskIds).eq("status", "open");
    for (const t of (open ?? []) as { id: string }[]) openTasks.add(t.id.toLowerCase());
  }
  // Aynı başlık + türdeki tekrarlı kayıtlar (ör. cron uyarıları) bu sayfada tek satır: "× N".
  const groups = groupNotifications(rows);
  const nowMs = now();
  const total = count ?? rows.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(pageParam, totalPages);
  const unread = counts.unread;
  const totalAll = counts.total;

  /** Aktif filtreleri koruyarak link üretir (sayfa değişince filtre kaybolmasın). */
  const buildHref = (patch: { durum?: string | null; tur?: string | null; konu?: string | null; sayfa?: number }) => {
    const params = new URLSearchParams();
    const d = patch.durum === undefined ? durum : patch.durum ?? undefined;
    const t = patch.tur === undefined ? tur : patch.tur ?? undefined;
    const k = patch.konu === undefined ? konu : patch.konu ?? undefined;
    if (d) params.set("durum", d);
    if (t) params.set("tur", t);
    if (k) params.set("konu", k);
    if ((patch.sayfa ?? 1) > 1) params.set("sayfa", String(patch.sayfa));
    const qs = params.toString();
    return qs ? `/app/bildirimler?${qs}` : "/app/bildirimler";
  };

  const filtersActive = Boolean(durum || tur || konu);

  // C22: karar bekleyen işler başta. Canlı sayılar (onay kuyruğu, geciken görev) tek tanımdan; okunmamış karar
  // bildirimleri (zil rozetiyle aynı kural) yalnız ilk sayfada ve süzgeçsiz görünümde listenin başına alınır.
  const decider = canDecideApproval(ctx.role, ctx.perms);
  const [{ count: pendingApprovals }, { count: overdueTasks }] = await Promise.all([
    decider && ctx.tenantId
      ? supabase.from("approval_requests").select("id", { count: "exact", head: true }).eq("tenant_id", ctx.tenantId).eq("status", "bekliyor").neq("requested_by", ctx.userId)
      : Promise.resolve({ count: 0 }),
    ctx.tenantId && (ctx.perms.tasks ?? []).length > 0 ? overdueTasksCountQuery(supabase, ctx.tenantId, ctx.userId) : Promise.resolve({ count: 0 }),
  ]);
  const showDecisions = !filtersActive && page === 1;
  const decisionGroups = showDecisions ? groups.filter((g) => g.unreadIds.length > 0 && isDecisionNotification(g.head)).slice(0, 5) : [];
  const decisionIds = new Set(decisionGroups.map((g) => g.head.id));
  const otherGroups = groups.filter((g) => !decisionIds.has(g.head.id));
  const decisionLinks = [
    (pendingApprovals ?? 0) > 0 ? { href: "/app/onaylar", label: "Onay bekleyen talep", count: pendingApprovals ?? 0 } : null,
    (overdueTasks ?? 0) > 0 ? { href: OVERDUE_TASKS_HREF, label: "Geciken görev", count: overdueTasks ?? 0 } : null,
  ].filter((v): v is { href: string; label: string; count: number } => v !== null);

  type Group = (typeof groups)[number];
  const renderRow = ({ head: n, count: groupCount, unreadIds }: Group) => (
              <div
                key={n.id}
                data-testid="bildirim-satiri"
                className={`relative flex items-start gap-3 px-5 py-3.5 transition hover:bg-canvas/60 ${
                  n.read_at ? "" : "bg-brand-600/[0.03]"
                }`}
              >
                {/* Satır tıklaması: href varsa gezinme, yoksa tekil okundu işaretleme */}
                {n.href ? (
                  <Link href={n.href} className="absolute inset-0" aria-label={n.title} />
                ) : unreadIds.length > 0 ? (
                  <MarkReadForm action={markNotificationReadForm} ids={unreadIds} className="absolute inset-0">
                    <button
                      type="submit"
                      className="h-full w-full cursor-pointer"
                      title="Okundu işaretle"
                      aria-label={`${n.title} bildirimini okundu işaretle`}
                    />
                  </MarkReadForm>
                ) : null}
                <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${n.read_at ? "bg-line-strong" : dotColor[n.kind] ?? "bg-brand-500"}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className={`truncate text-sm ${n.read_at ? "font-medium" : "font-semibold"} text-ink-950`}>{n.title}</p>
                    {groupCount > 1 ? (
                      <span
                        className="shrink-0 rounded-full bg-canvas px-1.5 py-0.5 text-xs font-semibold tabular-nums text-text-muted"
                        title={`Bu sayfada aynı başlıkta ${groupCount} bildirim`}
                      >
                        × {groupCount}
                      </span>
                    ) : null}
                    {topicCounts && isNotificationTopic(n.topic) ? (
                      <Link
                        href={buildHref({ konu: konu === n.topic ? null : n.topic, tur: null })}
                        title={`"${TOPIC_LABEL[n.topic]}" konusunu filtrele`}
                        className="relative z-10 shrink-0 rounded-full bg-canvas px-1.5 py-0.5 text-xs font-bold uppercase tracking-[0.08em] text-text-faint transition hover:bg-brand-600/10 hover:text-brand-600"
                      >
                        {TOPIC_LABEL[n.topic]}
                      </Link>
                    ) : (
                      <Link
                        href={buildHref({ tur: tur === n.kind ? null : n.kind })}
                        title={`"${kindLabel[n.kind] ?? n.kind}" türünü filtrele`}
                        className="relative z-10 shrink-0 rounded-full bg-canvas px-1.5 py-0.5 text-xs font-bold uppercase tracking-[0.08em] text-text-faint transition hover:bg-brand-600/10 hover:text-brand-600"
                      >
                        {kindLabel[n.kind] ?? n.kind}
                      </Link>
                    )}
                  </div>
                  {n.body ? <p className="mt-0.5 truncate text-xs text-text-muted">{n.body}</p> : null}
                </div>
                {/* Birincil satır eylemi (GA-08): görev hatırlatmasında görevi buradan kapatın (bildirim de okunur). */}
                {n.taskId && openTasks.has(n.taskId) ? (
                  <MarkReadForm action={completeTaskFromNotificationForm} ids={unreadIds} className="relative z-10 shrink-0" errorFallback="Görev tamamlanamadı">
                    <input type="hidden" name="task_id" value={n.taskId} />
                    <Button type="submit" variant="outline" size="sm" icon={Check} title="Görevi tamamla" className="max-sm:w-11 max-sm:px-0">
                      <span className="max-sm:sr-only">Tamamla</span>
                    </Button>
                  </MarkReadForm>
                ) : null}
                {/* href'li okunmamış satırda gezinmeden bağımsız okundu düğmesi */}
                {n.href && unreadIds.length > 0 ? (
                  <MarkReadForm action={markNotificationReadForm} ids={unreadIds} className="relative z-10 shrink-0">
                    <button
                      type="submit"
                      title="Okundu işaretle"
                      aria-label={`${n.title} bildirimini okundu işaretle`}
                      className="focus-ring press grid h-10 w-10 place-items-center rounded-[var(--radius-control)] border border-line bg-surface text-text-muted transition hover:border-brand-300 hover:text-brand-600 touch:min-h-11 touch:min-w-11"
                    >
                      <CheckCheck className="h-3.5 w-3.5" />
                    </button>
                  </MarkReadForm>
                ) : null}
                <span className="shrink-0 text-xs text-text-faint">
                  <time dateTime={n.created_at}>{notificationTimeLabel(n.created_at, nowMs)}</time>
                </span>
              </div>
  );

  return (
    <div className="space-y-5">
      <PageHeader title="Bildirimler" eyebrow="Bildirim merkezi" icon={<IconChip icon={BellRing} size="lg" />} description={`${unread > 0 ? `${unread} okunmamış bildiriminiz var.` : "Tüm bildirimler okundu — güncel durumdasınız."}${konu ? ` · "${TOPIC_LABEL[konu]}" konusu filtrede` : ""}${tur ? ` · "${kindLabel[tur]}" türü filtrede` : ""}${durum ? " · yalnız okunmamışlar" : ""}`} actions={<>{unread > 0 ? (
              <MarkReadForm action={markAllNotificationsReadForm} errorFallback="Bildirimler okundu işaretlenemedi">
                <Button type="submit" variant="outline" size="sm" icon={CheckCheck}>
                  Tümünü okundu işaretle
                </Button>
              </MarkReadForm>
            ) : null}</>} />
      {/* Bağlam içi anlık bildirim daveti (MP1): yalnız desteklenen ve henüz açılmamış cihazda; izin dokunuşla istenir. */}
      <PushEnableCard />
      {/* C22: önce karar — istatistik kartı yok; ilk ekranda iş ve bildirim satırları başlar. */}
      {showDecisions ? (
        <section data-testid="karar-bekleyenler" aria-labelledby="karar-bekleyenler-baslik" className="overflow-hidden rounded-[var(--radius-panel)] border border-amber-400/40 bg-surface">
          <div className="flex items-center gap-2 border-b border-line px-5 py-3">
            <BellRing aria-hidden="true" className="h-4 w-4 text-amber-600" />
            <h2 id="karar-bekleyenler-baslik" className="text-sm font-semibold text-ink-950">Sizden karar bekleyenler</h2>
          </div>
          {decisionLinks.length === 0 && decisionGroups.length === 0 ? (
            <p className="px-5 py-3 text-sm text-text-muted">Şu an sizden karar bekleyen iş yok.</p>
          ) : (
            <div className="divide-y divide-line">
              {decisionLinks.map((d) => (
                <Link key={d.href} href={d.href} className="focus-ring flex min-h-11 items-center gap-3 px-5 py-2.5 text-sm font-semibold text-ink-950 transition hover:bg-canvas/60">
                  <span className="numeric grid h-7 min-w-7 place-items-center rounded-full bg-amber-400/20 px-1.5 text-xs font-bold text-amber-700">{d.count > 99 ? "99+" : d.count}</span>
                  {d.label}
                  <ArrowUpRight aria-hidden="true" className="ml-auto h-4 w-4 text-text-faint" />
                </Link>
              ))}
              {decisionGroups.map(renderRow)}
            </div>
          )}
        </section>
      ) : null}

      {/* Filtre çipleri: durum + konu — URL iki yönlü (aktifken tıklama kaldırır). Dengeli görünümde de görünür (tek satır). */}
      <nav aria-label="Bildirim filtresi" className="flex flex-wrap items-center gap-2">
        <FilterChip href={buildHref({ durum: null, tur: null, konu: null })} active={!filtersActive}>
          Tümü{totalAll > 0 ? ` (${totalAll})` : ""}
        </FilterChip>
        <FilterChip href={buildHref({ durum: durum ? null : "okunmamis" })} active={Boolean(durum)}>
          Okunmamış{unread > 0 ? ` (${unread})` : ""}
        </FilterChip>
        <span aria-hidden className="mx-1 h-4 w-px bg-line" />
        {topicCounts
          ? NOTIFICATION_TOPICS.filter((k) => (topicCounts[k] ?? 0) > 0 || konu === k).map((k) => (
              <FilterChip key={k} href={buildHref({ konu: konu === k ? null : k, tur: null })} active={konu === k}>
                {TOPIC_LABEL[k]}
                {(topicCounts[k] ?? 0) > 0 ? ` (${topicCounts[k]})` : ""}
              </FilterChip>
            ))
          : null}
        {topicCounts ? null : Object.entries(kindLabel).map(([v, l]) => (
          <FilterChip key={v} href={buildHref({ tur: tur === v ? null : v })} active={tur === v}>
            <span className={`h-2 w-2 rounded-full ${dotColor[v]}`} />
            {l}
            {kindCounts[v] > 0 ? ` (${kindCounts[v]})` : ""}
          </FilterChip>
        ))}
      </nav>

      <section className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface">
        <div className="flex items-center gap-2 border-b border-line px-5 py-3.5">
          <Bell className="h-4 w-4 text-brand-600" />
          <h2 className="text-sm font-semibold text-ink-950">{decisionGroups.length > 0 ? "Diğer bildirimler" : "Gelen kutusu"}</h2>
          <span className="ml-auto text-xs tabular-nums text-text-faint">{total} kayıt</span>
        </div>

        {otherGroups.length === 0 && decisionGroups.length > 0 ? (
          <p className="px-5 py-6 text-sm text-text-muted">Bu sayfadaki diğer bildirimler yukarıda.</p>
        ) : rows.length === 0 ? (
          <div className="relative overflow-hidden px-4 py-16 text-center">
            <div className="pointer-events-none absolute left-1/2 top-4 h-32 w-32 -translate-x-1/2 rounded-full bg-brand-600/15 blur-[60px]" />
            <span className="relative mx-auto grid h-14 w-14 place-items-center rounded-[var(--radius-card)] bg-brand-600/10 text-brand-600">
              <Inbox className="h-7 w-7" />
            </span>
            <p className="relative mt-3 text-sm font-semibold text-ink-950">
              {filtersActive ? "Filtreye uyan bildirim yok" : total > 0 ? "Bu sayfada kayıt yok" : "Henüz bildirim yok"}
            </p>
            <p className="relative mt-1 text-xs text-text-muted">
              {filtersActive ? (
                <>
                  <Link href="/app/bildirimler" className="font-semibold text-brand-600 hover:underline">
                    Filtreyi temizleyip
                  </Link>{" "}
                  tüm bildirimlere bakabilirsiniz.
                </>
              ) : total > 0 ? (
                <>
                  Sayfa numarası aralık dışında.{" "}
                  <Link href={buildHref({ sayfa: 1 })} className="font-semibold text-brand-600 hover:underline">
                    İlk sayfaya dön
                  </Link>
                </>
              ) : (
                "Randevu hatırlatmaları, eşleşme haberleri ve sistem duyuruları burada birikecek."
              )}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-line">
            {otherGroups.map(renderRow)}
          </div>
        )}

        {totalPages > 1 ? (
          <nav aria-label="Sayfalama" className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
            {page > 1 ? (
              <Link href={buildHref({ sayfa: page - 1 })} className="focus-ring press inline-flex min-h-[40px] items-center rounded-[var(--radius-control)] border border-line px-3 py-1.5 text-xs font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600 touch:min-h-11">
                ← Önceki
              </Link>
            ) : (
              <span className="inline-flex min-h-[40px] items-center rounded-[var(--radius-control)] border border-line px-3 py-1.5 text-xs font-semibold text-text-faint opacity-50">← Önceki</span>
            )}
            <span className="text-xs tabular-nums text-text-muted">Sayfa {page} / {totalPages}</span>
            {page < totalPages ? (
              <Link href={buildHref({ sayfa: page + 1 })} className="focus-ring press inline-flex min-h-[40px] items-center rounded-[var(--radius-control)] border border-line px-3 py-1.5 text-xs font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600 touch:min-h-11">
                Sonraki →
              </Link>
            ) : (
              <span className="inline-flex min-h-[40px] items-center rounded-[var(--radius-control)] border border-line px-3 py-1.5 text-xs font-semibold text-text-faint opacity-50">Sonraki →</span>
            )}
          </nav>
        ) : null}
      </section>
    </div>
  );
}

type NotificationListRow = {
  id: string;
  title: string;
  body: string | null;
  href: string | null;
  kind: string;
  topic?: string | null;
  read_at: string | null;
  created_at: string;
};
type ReadEmbed = { read_at: string | null }[] | null;
type Db = Awaited<ReturnType<typeof createClient>>;

const COUNTS_RPC = "my_notification_counts";
/** Tablo/ilişki henüz yok (migration uygulanmadı): PostgREST ilişki/şema önbelleği ya da Postgres "relation yok". */
const RELATION_MISSING = new Set(["PGRST200", "PGRST205", "42P01"]);
/** Kolon yok: Postgres 42703 / PostgREST şema önbelleği PGRST204. */
const TOPIC_MISSING = new Set(["42703", "PGRST204"]);
const LIST_COLUMNS = "id, title, body, href, kind, created_at, reads:notification_reads(read_at)";
const LIST_COLUMNS_TOPIC = "id, title, body, href, kind, topic, created_at, reads:notification_reads(read_at)";

/**
 * Sayfa verisi: liste (sunucu süzgeci + gerçek sayfalama) + sayaçlar. Okunma kişi başı tablodan gömülür; "okunmamış"
 * süzgeci PostgREST anti-join'i (`reads=is.null`, gömme kendi satırıyla sınırlı). Sayaçlar tek RPC. Migration yoksa
 * (RPC/tablo yok) eski tek sütun (`notifications.read_at`) sorgularına düşer.
 */
async function loadNotificationsPage(
  supabase: Db,
  userId: string,
  opts: { durum?: string; tur?: string; konu?: string; offset: number },
): Promise<{ rows: NotificationListRow[]; total: number; counts: NotificationCounts }> {
  const mineOr = `user_id.eq.${userId},user_id.is.null`;
  const range = [opts.offset, opts.offset + PAGE_SIZE - 1] as const;

  if (!rpcKnownMissing(COUNTS_RPC)) {
    const buildList = (withTopic: boolean) => {
      let q = supabase
        .from("notifications")
        .select(withTopic ? LIST_COLUMNS_TOPIC : LIST_COLUMNS, { count: "exact" })
        .or(mineOr)
        .eq("reads.user_id", userId);
      if (opts.durum) q = q.is("reads", null);
      if (opts.tur) q = q.eq("kind", opts.tur);
      if (withTopic && opts.konu) q = q.eq("topic", opts.konu);
      return q.order("created_at", { ascending: false }).range(range[0], range[1]);
    };
    // batchAll DEĞİL: migration yokken (RPC PGRST202 / gömme PGRST200) fırlatmadan eski yola düşülmeli.
    const [firstList, countsRes] = await Promise.all([buildList(true), supabase.rpc(COUNTS_RPC)]);
    // Konu kolonu yok (migration 20261018050000 uygulanmadı): konusuz liste (konu süzgeci yok sayılır).
    const list = firstList.error && TOPIC_MISSING.has(firstList.error.code ?? "") ? await buildList(false) : firstList;
    recordRpcOutcome(COUNTS_RPC, countsRes.error);
    const missing = isMissingFunctionError(countsRes.error) || RELATION_MISSING.has(list.error?.code ?? "");
    if (!missing) {
      assertQueryBatchSucceeded([list, countsRes], ["liste", "sayaçlar"], "Bildirimler");
      const rows = ((list.data ?? []) as unknown as (Omit<NotificationListRow, "read_at"> & { reads: ReadEmbed })[]).map(({ reads, ...n }) => ({
        ...n,
        read_at: reads?.[0]?.read_at ?? null,
      }));
      return { rows, total: list.count ?? rows.length, counts: parseNotificationCounts(countsRes.data) };
    }
  }

  // Eski yol (migration öncesi): okunma tek sütunda, sayaçlar ayrı count sorguları.
  let listQuery = supabase
    .from("notifications")
    .select("id, title, body, href, kind, read_at, created_at", { count: "exact" })
    .or(mineOr);
  if (opts.durum) listQuery = listQuery.is("read_at", null);
  if (opts.tur) listQuery = listQuery.eq("kind", opts.tur);
  const countBase = () => supabase.from("notifications").select("id", { count: "exact", head: true }).or(mineOr);
  const kindKeys = Object.keys(kindLabel);
  const [{ data, count }, { count: unreadCount }, { count: allCount }, { count: weekCount }, ...kindCountRes] =
    await batchAll("Bildirimler", [], [
      listQuery.order("created_at", { ascending: false }).range(range[0], range[1]),
      countBase().is("read_at", null),
      countBase(),
      countBase().gte("created_at", daysAgoIso(7)),
      ...kindKeys.map((k) => countBase().eq("kind", k)),
    ]);
  const kinds: Record<string, number> = {};
  kindKeys.forEach((k, i) => {
    kinds[k] = kindCountRes[i]?.count ?? 0;
  });
  const rows = (data ?? []) as NotificationListRow[];
  return {
    rows,
    total: count ?? rows.length,
    counts: { unread: unreadCount ?? 0, total: allCount ?? 0, week: weekCount ?? 0, kinds },
  };
}
