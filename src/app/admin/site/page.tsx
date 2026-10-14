import Link from "@/components/ui/smart-link";
import { AlertTriangle, ArrowUpRight, CalendarClock, Globe, History, Info, Rocket } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { DAY_MS, now, toTrLocalInput } from "@/lib/clock";
import { redirect } from "next/navigation";
import { requirePlatformStaff } from "@/lib/platform";
import { ADMIN_NAV } from "@/lib/admin/nav";
import { platformCanAccess } from "@/lib/platform-access";
import { getGeneralSettings } from "@/lib/platform-flags";
import { diffJson } from "@/lib/publishing/diff";
import { MIN_LEAD_MS, hashOf, isOpen } from "@/lib/publishing/schedule";
import { readSchedule } from "@/lib/publishing/store";
import { SURFACES, deskGuideSurfaces, type SurfaceState } from "@/lib/publishing/surfaces";
import { HUB_CARDS, type HubCardId } from "@/lib/site-hub/cards";
import { readLastChanges } from "@/lib/site-hub/last-changes";
import { readVerifyBadges, type VerifyBadge } from "@/lib/publishing/after-publish";
import { Kokpit } from "./_kokpit/kokpit";
import { RecheckButton } from "./_kokpit/kokpit-actions";
import { loadKokpit } from "./_kokpit/load";
import { parseAreaFilter } from "./_kokpit/model";
import { CancelScheduleButton, DraftDiffLink, HistoryRowActions, PublishNowButton, ScheduleButton } from "./publishing-desk";

export const metadata = { title: "Site, SEO ve Reklam" };

/** Sayfa kapısı menü öğesinin modülleriyle aynıdır (tek kaynak: nav.ts); öğe görünüyorsa sayfa açılır. */
const SITE_MODULES = ADMIN_NAV.flatMap((s) => s.items).find((i) => i.href === "/admin/site")?.modules ?? [];

type Chip = { text: string; tone: "ok" | "warn" | "info" };

const TONE: Record<Chip["tone"], string> = {
  ok: "bg-mint-500/15 text-mint-700",
  warn: "bg-amber-100 text-amber-900",
  info: "bg-brand-600/10 text-brand-700",
};

const fmt = (iso: string) => toTrLocalInput(iso).replace("T", " ");
const FEED_LIMIT = 20;

function ChipList({ chips }: { chips: Chip[] }) {
  if (!chips.length) return null;
  return (
    <span className="flex flex-wrap gap-1.5">
      {chips.map((ch) => (
        <span key={ch.text} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${TONE[ch.tone]}`}>
          {ch.tone === "warn" ? <AlertTriangle className="h-3 w-3" aria-hidden="true" /> : null}
          {ch.text}
        </span>
      ))}
    </span>
  );
}

/**
 * Site yönetimi "Genel bakış" = BÜYÜME KOKPİTİ (üstte; `seo` modülü: süper admin + operasyon) + YAYIN MASASI:
 * taslak/yayın akışı olan yüzeylerin (site menüsü, site içeriği, SEO sayfa ayarları, taslaklı rehber yazıları) durumu ve canlı doğrulama rozeti, zamanlanmış yayın
 * takvimi, son yayın akışı (fark + bu sürüme dön). Diğer yönetim alanları bağlantı kartı olarak kalır.
 * Sayfa yalnız toplanmış tabloları okur (Promise.all; render sırasında dış çağrı yok).
 */
export default async function AdminSiteHubPage({ searchParams }: { searchParams: Promise<{ alan?: string | string[] }> }) {
  // Kapı = menü öğesinin modülleri (nav.ts "Site, SEO ve Reklam"): en az biri açık olmalı; aksi halde /admin.
  const staff = await requirePlatformStaff();
  if (!SITE_MODULES.some((m) => platformCanAccess(staff, m))) redirect("/admin");
  const canWrite = staff.role === "super_admin";
  const showKokpit = platformCanAccess(staff, "seo");
  const fixed = SURFACES.filter((s) => platformCanAccess(staff, s.module));
  // Rehber yazıları (S5 dikişi): yazı başına dinamik yüzey; yalnız bekleyen taslağı ya da zamanlaması olanlar listelenir.
  const canGuides = platformCanAccess(staff, "sitecontent");
  const linkCards = HUB_CARDS.filter((c) => !c.hasDraft && platformCanAccess(staff, c.module));
  const wants = (id: HubCardId) => linkCards.some((c) => c.id === id);
  const filter = parseAreaFilter((await searchParams).alan);

  const [last, general, schedule, fixedStates, kokpit, badges, guideCandidates] = await Promise.all([
    readLastChanges(),
    wants("bakim-kayit") ? getGeneralSettings() : null,
    fixed.length || canGuides ? readSchedule() : [],
    Promise.all(fixed.map((s) => s.readState())),
    showKokpit ? loadKokpit(filter) : null,
    fixed.length || canGuides ? readVerifyBadges() : {},
    canGuides ? deskGuideSurfaces().catch(() => []) : [],
  ]);
  // Yalnız aday yazıların (en çok 20) durumu ikinci turda okunur; okunamayan yazı masada gösterilmez.
  const guideStates = await Promise.all(guideCandidates.map((s) => s.readState().catch(() => null)));
  const guides = guideCandidates.flatMap((s, i) => (guideStates[i] ? [{ s, st: guideStates[i] }] : []));
  const surfaces = [...fixed, ...guides.map((g) => g.s)];
  const states: SurfaceState[] = [...fixedStates, ...guides.map((g) => g.st)];
  const isGuide = (id: string) => id.startsWith("guide:");

  const nowMs = now();
  const minLocal = toTrLocalInput(nowMs + MIN_LEAD_MS + 60_000);
  const visibleIds = new Set<string>(surfaces.map((s) => s.id));
  const open = schedule.filter((e) => isOpen(e) && (visibleIds.has(e.surface) || (canGuides && isGuide(e.surface))));

  const rows = surfaces
    .map((s, i) => {
      const st = states[i]!;
      const base = st.live ?? s.defaults();
      const changes = st.draft && hashOf(st.draft) !== hashOf(base) ? diffJson(base, st.draft).total : 0;
      const pending = open.filter((e) => e.surface === s.id);
      const chips: Chip[] = [st.live ? { text: "Yayında", tone: "ok" } : isGuide(s.id) ? { text: "Yayında değil", tone: "info" } : { text: "Varsayılan", tone: "info" }];
      if (changes > 0) chips.push({ text: "Taslak var", tone: "warn" });
      if (pending.length > 0) chips.push({ text: pending.length > 1 ? `Zamanlandı (${pending.length})` : "Zamanlandı", tone: "info" });
      const badge = (badges as Record<string, VerifyBadge>)[s.id] ?? null;
      return { s, st, changes, chips, badge, pending: pending.length };
    })
    .filter((r) => !isGuide(r.s.id) || r.changes > 0 || r.pending > 0);
  const nothingLive = fixed.length > 0 && rows.filter((r) => !isGuide(r.s.id)).every((r) => !r.st.live);

  const horizon = nowMs + 30 * DAY_MS;
  const calendar = open
    .filter((e) => e.status === "yayinda" || Date.parse(e.publishAt) <= horizon)
    .sort((a, b) => Date.parse(a.publishAt) - Date.parse(b.publishAt));

  const liveHashes = new Map(rows.map((r) => [r.s.id, r.st.live ? hashOf(r.st.live) : null]));
  const feed = rows
    .flatMap((r) => r.st.history.map((h) => ({ surface: r.s, h, isLive: liveHashes.get(r.s.id) === hashOf(h.cfg) })))
    .sort((a, b) => Date.parse(b.h.at) - Date.parse(a.h.at))
    .slice(0, FEED_LIMIT);
  const labelOf = (id: string) => surfaces.find((s) => s.id === id)?.label ?? (isGuide(id) ? "Rehber yazısı" : id);

  const linkChips: Partial<Record<HubCardId, Chip[]>> = {};
  if (general) {
    linkChips["bakim-kayit"] = [
      // Bakım kapsamı varsayılan yalnız ofis panelidir (ana sayfa açık kalır); kapsam Özellik bayraklarında ayarlanır.
      general.maintenanceMode ? { text: "Bakım modu AÇIK: kapsamdaki sayfalar bakım ekranında", tone: "warn" } : { text: "Bakım modu kapalı", tone: "ok" },
      general.registrationOpen ? { text: "Kayıt açık", tone: "ok" } : { text: "Yeni kayıt kapalı", tone: "warn" },
    ];
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        eyebrow="Platform"
        icon={Globe}
        title="Site, SEO ve Reklam"
        description="Büyüme kokpiti: Site notu, tek kuyrukta öneriler ve Otopilot. Altında Yayın masası: taslaklar, zamanlanmış yayınlar ve son sürümler."
        glow="brand"
      />

      {kokpit ? <Kokpit model={kokpit.model} role={staff.role} autopilot={kokpit.autopilot} autopilotRun={kokpit.autopilotRun} /> : null}

      {surfaces.length ? (
        <section aria-labelledby="yayin-masasi" className="space-y-4">
          <h2 id="yayin-masasi" className="flex items-center gap-2 font-display text-lg font-extrabold text-ink-950">
            <Rocket className="h-5 w-5 text-brand-600" aria-hidden="true" /> Yayın masası
          </h2>

          {nothingLive ? (
            <p className="flex gap-3 rounded-[var(--radius-panel)] border border-brand-400/40 bg-brand-600/5 p-4 text-sm text-ink-950">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden="true" />
              Site şu an kod varsayılanlarıyla çalışıyor. Değiştirmek için ilgili editörü açın; yayınlamadıkça hiçbir şey değişmez.
            </p>
          ) : null}

          <ul className="divide-y divide-line rounded-[var(--radius-panel)] border border-line bg-surface" aria-label="Yayın yüzeyleri">
            {rows.map(({ s, st, changes, chips, badge }) => (
              <li key={s.id} className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0 space-y-1.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-display text-base font-extrabold text-ink-950">{s.label}</span>
                    <ChipList chips={chips} />
                  </span>
                  <span className="block text-xs text-text-faint">
                    {st.updatedAt ? `Son yayın: ${fmt(st.updatedAt)}${st.updatedBy ? ` · ${st.updatedBy}` : ""}` : "Henüz yayın yapılmadı (kod varsayılanı)"}
                  </span>
                  {badge ? (
                    <span className="flex flex-wrap items-center gap-1.5">
                      <ChipList chips={[{ text: badge.message, tone: badge.ok ? "ok" : "warn" }]} />
                      {!badge.ok && showKokpit ? <RecheckButton surface={s.id} /> : null}
                    </span>
                  ) : null}
                  {changes > 0 ? <DraftDiffLink surface={s.id} count={changes} /> : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={s.editorHref} className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] border border-line px-3 text-xs font-bold text-ink-950 transition hover:border-brand-400 touch:h-11">
                    Editörü aç <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </Link>
                  <ScheduleButton surface={s.id} surfaceLabel={s.label} minLocal={minLocal} disabled={!canWrite || changes === 0} />
                  {canWrite && changes > 0 ? <PublishNowButton surface={s.id} surfaceLabel={s.label} /> : null}
                </div>
              </li>
            ))}
          </ul>

          <div className="grid gap-4 xl:grid-cols-2">
            <section aria-labelledby="takvim" className="rounded-[var(--radius-panel)] border border-line bg-surface p-4">
              <h3 id="takvim" className="mb-3 flex items-center gap-2 text-sm font-extrabold text-ink-950">
                <CalendarClock className="h-4 w-4 text-brand-600" aria-hidden="true" /> Takvim · önümüzdeki 30 gün
              </h3>
              {calendar.length ? (
                <ul className="divide-y divide-line">
                  {calendar.map((e) => (
                    <li key={e.id} className="flex items-start justify-between gap-3 py-2.5">
                      <div className="min-w-0 text-sm">
                        <p className="font-bold text-ink-950">
                          {labelOf(e.surface)} · {e.label}
                        </p>
                        <p className="text-xs text-text-muted">
                          {e.status === "yayinda" ? "Yayında" : `Başlangıç ${fmt(e.publishAt)}`}
                          {e.unpublishAt ? ` · bitiş ${fmt(e.unpublishAt)} (önceki sürüme dönülür)` : " · bitiş yok"}
                        </p>
                        <p className="text-xs text-text-faint">Zamanlayan: {e.byName || "bilinmiyor"}</p>
                      </div>
                      {canWrite ? <CancelScheduleButton id={e.id} live={e.status === "yayinda"} /> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-text-muted">Zamanlanmış yayın yok. Bir yüzeyde taslak varsa &quot;Taslağı zamanla&quot; ile ileri bir tarihe kurabilirsiniz.</p>
              )}
            </section>

            <section aria-labelledby="akis" className="rounded-[var(--radius-panel)] border border-line bg-surface p-4">
              <h3 id="akis" className="mb-3 flex items-center gap-2 text-sm font-extrabold text-ink-950">
                <History className="h-4 w-4 text-brand-600" aria-hidden="true" /> Son yayınlar
              </h3>
              {feed.length ? (
                <ul className="divide-y divide-line">
                  {feed.map(({ surface, h, isLive }) => (
                    <li key={`${surface.id}:${h.id}`} className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0 text-sm">
                        <p className="font-bold text-ink-950">
                          {surface.label} · {h.label}
                          {isLive ? <span className="ml-2 rounded-full bg-mint-500/15 px-2 py-0.5 text-xs font-bold text-mint-700">Canlı</span> : null}
                        </p>
                        <p className="text-xs text-text-faint">
                          {fmt(h.at)}
                          {h.by ? ` · ${h.by}` : ""}
                        </p>
                      </div>
                      <HistoryRowActions surface={surface.id} historyId={h.id} canWrite={canWrite} isLive={isLive} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-text-muted">Henüz yayın yok. İlk yayından sonra her sürüm burada listelenir ve tek tıkla geri dönülebilir.</p>
              )}
            </section>
          </div>
        </section>
      ) : null}

      <section aria-labelledby="diger-alanlar" className="space-y-3">
        <h2 id="diger-alanlar" className="font-display text-lg font-extrabold text-ink-950">Diğer yönetim alanları</h2>
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Yönetilebilir alanlar">
          {linkCards.map((c) => {
            const l = last[c.id];
            return (
              <li key={c.id}>
                <Link
                  href={c.href}
                  className="focus-ring group flex h-full flex-col gap-3 rounded-[var(--radius-panel)] border border-line bg-surface p-4 transition hover:border-brand-400"
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="font-display text-base font-extrabold text-ink-950">{c.title}</span>
                    <ArrowUpRight className="h-4 w-4 shrink-0 text-text-faint transition group-hover:text-brand-600" aria-hidden="true" />
                  </span>
                  <span className="text-sm text-text-muted">{c.description}</span>
                  <ChipList chips={linkChips[c.id] ?? []} />
                  {l ? (
                    <span className="mt-auto text-xs text-text-faint">
                      Son değişiklik: {fmt(l.at)}
                      {l.actorName ? ` · ${l.actorName}` : ""}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
