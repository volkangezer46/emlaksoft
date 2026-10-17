"use client";

/* eslint-disable @next/next/no-img-element -- portföy kapakları korumalı/herkese açık medya ucundan gelir; next/image optimizasyonu TV'de gerekmez */
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import {
  Award,
  BadgeCheck,
  Bell,
  BellRing,
  BriefcaseBusiness,
  Building2,
  CalendarClock,
  CalendarX2,
  CircleDollarSign,
  ClipboardList,
  Gauge,
  Handshake,
  Inbox,
  Megaphone,
  Medal as MedalIcon,
  PhoneIncoming,
  Pin,
  Radio,
  Target,
  Trophy,
  UserPlus,
  Users,
  Wifi,
} from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { appointmentTypeLabel } from "@/lib/appointment-labels";
import { formatTrTime, trParts, DAY_MS } from "@/lib/clock";
import type { TvData, TvKpi, TvLeagueRow, TvListing } from "@/lib/tv/tv-data";
import { perItemMs, windowAroundNow } from "@/lib/tv/tv-logic";
import { tvGreeting } from "./tv-greeting";
import { AreaBars, Confetti, Delta, Flame, Medal, MiniBars, TvEmpty, TvNumber, TvRing, money, nf } from "./tv-viz";

export type SceneProps = {
  data: TvData;
  nowMs: number;
  sceneMs: number;
  paused: boolean;
  fresh: ReadonlySet<string>;
  device: boolean;
  /** Canlı bağlantı türü (sistem sahnesi). */
  live: "realtime" | "poll";
  updatedAt: number;
};

const ico = { width: "1em", height: "1em" } as const;

export function fmtAgo(iso: string, nowMs: number): string {
  const mins = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 60_000));
  if (mins < 1) return "şimdi";
  if (mins < 60) return `${mins} dk önce`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} sa önce`;
  return `${Math.round(h / 24)} gün önce`;
}

function Panel({ title, icon, aside, className = "", children }: { title: string; icon: ReactNode; aside?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={`tv-glass ${className}`} aria-label={title}>
      <h3 className="tv-panel-title">
        <span className="tv-chip-ico" aria-hidden>
          {icon}
        </span>
        <span className="tv-panel-name">{title}</span>
        {aside ? <span className="tv-panel-aside">{aside}</span> : null}
      </h3>
      {children}
    </section>
  );
}

function SceneHead({ kicker, title, lead }: { kicker: string; title: ReactNode; lead?: ReactNode }) {
  return (
    <header className="tv-scene-head">
      <span className="tv-kicker">{kicker}</span>
      <h2 className="tv-scene-title">{title}</h2>
      {lead ? <p className="tv-scene-lead">{lead}</p> : null}
    </header>
  );
}

/** Sahne zemini: fotoğraf (varsa) + lacivert örtü. Fotoğraf yoksa yalnız degrade. */
export function SceneBackdrop({ src }: { src: string | null }) {
  return (
    <div className="tv-backdrop" aria-hidden>
      {src ? <img src={src} alt="" decoding="async" /> : null}
      <span className="tv-backdrop-veil" />
    </div>
  );
}

/* ================================ 1 · Bugün ================================ */

const APPT_STATUS: Record<string, string> = { pending: "Bekliyor", confirmed: "Onaylı", completed: "Tamamlandı", signature: "İmza" };

export function SceneToday({ data, nowMs, fresh }: SceneProps) {
  const t = data.today;
  const { items, nextId } = windowAroundNow(t.appointments, nowMs, 7, 2);
  const nowIdx = items.findIndex((a) => Date.parse(a.at) >= nowMs);
  const greet = tvGreeting(nowMs);
  return (
    <div className="tv-scene-body tv-today">
      <SceneHead
        kicker="Bugün"
        title={
          <>
            {greet}, <em>{data.office.name}</em>
          </>
        }
        lead={
          <>
            Bugün <b>{nf.format(t.appointments.length)}</b> randevu, <b>{nf.format(t.tasksDueToday)}</b> görev ve <b>{nf.format(t.newLeadsToday)}</b> yeni müşteri
            {t.tasksOverdue > 0 ? (
              <>
                {" · "}
                <span className="tv-warn-text">{nf.format(t.tasksOverdue)} geciken görev</span>
              </>
            ) : null}
          </>
        }
      />
      <div className="tv-today-grid">
        <Panel title="Randevu akışı" icon={<CalendarClock style={ico} />} aside={t.appointments.length > items.length ? `${items.length} / ${t.appointments.length}` : null} className="tv-timeline-panel">
          {items.length === 0 ? (
            <TvEmpty icon={<CalendarX2 style={ico} />} text="Bugün için planlı randevu yok" hint="Yeni randevular eklendiğinde burada anında görünür" />
          ) : (
            <ol className="tv-timeline">
              {items.map((a, i) => (
                <TimelineItem key={a.id} a={a} past={Date.parse(a.at) < nowMs} next={nextId?.id === a.id} fresh={fresh.has(a.id)} nowLine={i === nowIdx} nowMs={nowMs} />
              ))}
              {nowIdx < 0 ? <NowLine nowMs={nowMs} /> : null}
            </ol>
          )}
        </Panel>
        <div className="tv-today-side">
          <Panel
            title="Görevler"
            icon={<ClipboardList style={ico} />}
            aside={
              <span className="tv-pills">
                <span className="tv-pill">{nf.format(t.tasksDueToday)} bugün</span>
                {t.tasksOverdue > 0 ? <span className="tv-pill" data-tone="bad">{nf.format(t.tasksOverdue)} geciken</span> : null}
              </span>
            }
          >
            {t.tasks.length === 0 ? (
              <TvEmpty icon={<BadgeCheck style={ico} />} text="Bugün için açık görev yok" />
            ) : (
              <ul className="tv-rows">
                {t.tasks.slice(0, 5).map((k) => (
                  <li key={k.id} className="tv-row-line">
                    <span className="tv-tag" data-tone={k.overdue ? "bad" : k.high ? "warn" : undefined}>
                      {k.kind}
                    </span>
                    <span className="tv-row-text">{k.advisor ?? "Atanmamış"}</span>
                    <span className="tv-row-meta">{k.overdue ? "Gecikti" : (k.time ?? "Bugün")}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Yeni müşteriler" icon={<UserPlus style={ico} />} aside={<span className="tv-pill">{nf.format(t.newLeadsToday)} bugün</span>}>
            {t.leads.length === 0 ? (
              <TvEmpty icon={<Inbox style={ico} />} text="Henüz yeni müşteri yok" />
            ) : (
              <ul className="tv-rows">
                {t.leads.slice(0, 5).map((l) => (
                  <li key={l.id} className="tv-row-line" data-fresh={fresh.has(`customer:${l.id}`)}>
                    <span className="tv-initial" aria-hidden>
                      {l.name.charAt(0)}
                    </span>
                    <span className="tv-row-text">
                      {l.name}
                      {l.source ? <small>{l.source}</small> : null}
                    </span>
                    <span className="tv-row-meta">{fmtAgo(l.at, nowMs)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

function NowLine({ nowMs }: { nowMs: number }) {
  return (
    <li className="tv-now" aria-label="Şimdi">
      <span>Şimdi {formatTrTime(new Date(nowMs).toISOString())}</span>
    </li>
  );
}

function TimelineItem({
  a,
  past,
  next,
  fresh,
  nowLine,
  nowMs,
}: {
  a: TvData["today"]["appointments"][number];
  past: boolean;
  next: boolean;
  fresh: boolean;
  nowLine: boolean;
  nowMs: number;
}) {
  return (
    <>
      {nowLine ? <NowLine nowMs={nowMs} /> : null}
      <li className="tv-tl-item" data-past={past} data-next={next} data-fresh={fresh}>
        <span className="tv-tl-time">{a.time}</span>
        <span className="tv-tl-dot" aria-hidden />
        <span className="tv-tl-card">
          <b>{a.customer}</b>
          <small>
            {appointmentTypeLabel(a.type)} · {a.advisor}
          </small>
        </span>
        <span className="tv-tl-state">{next ? <span className="tv-tag" data-tone="gold">Sıradaki</span> : APPT_STATUS[a.status] ? <span className="tv-tag">{APPT_STATUS[a.status]}</span> : null}</span>
      </li>
    </>
  );
}

/* ============================ 2 · Ofis performansı ============================ */

function KpiTile({ icon, label, value, kpi, isMoney, tone, sub }: { icon: ReactNode; label: string; value: number; kpi?: TvKpi; isMoney?: boolean; tone: string; sub?: string }) {
  return (
    <div className="tv-kpi tv-glass" data-tone={tone}>
      <div className="tv-kpi-top">
        <span className="tv-kpi-ico" aria-hidden>
          {icon}
        </span>
        <span className="tv-kpi-label">{label}</span>
      </div>
      <div className="tv-kpi-value">
        <TvNumber value={value} money={isMoney} />
      </div>
      <div className="tv-kpi-foot">
        {kpi ? <Delta current={kpi.value} previous={kpi.previous} /> : sub ? <span className="tv-kpi-sub">{sub}</span> : null}
        {kpi ? <MiniBars values={kpi.series} label={`${label}, son 14 gün`} /> : null}
      </div>
    </div>
  );
}

export function ScenePerformance({ data, nowMs }: SceneProps) {
  const k = data.kpis;
  const labels = Array.from({ length: 14 }, (_, i) => String(trParts(nowMs - (13 - i) * DAY_MS).day));
  const sumWon = k.wonDeals.series.reduce((s, v) => s + v, 0);
  const sumDem = k.newDemands.series.reduce((s, v) => s + v, 0);
  return (
    <div className="tv-scene-body tv-perf">
      <SceneHead kicker={`Ofis performansı · ${data.monthLabel}`} title="Bu ayın nabzı" lead="Geçen ayın aynı günlerine göre değişim" />
      <div className="tv-kpi-row">
        {data.moneyVisible && k.revenue !== null ? (
          <KpiTile icon={<CircleDollarSign style={ico} />} label="Ciro · bu ay" value={k.revenue} isMoney tone="gold" sub="Tahsil edilen brüt komisyon" />
        ) : (
          <KpiTile icon={<BriefcaseBusiness style={ico} />} label="Açık anlaşma" value={k.openDeals} tone="gold" sub="Süren satış süreçleri" />
        )}
        <KpiTile icon={<Handshake style={ico} />} label="Kazanılan anlaşma" value={k.wonDeals.value} kpi={k.wonDeals} tone="blue" />
        <KpiTile icon={<Users style={ico} />} label="Yeni müşteri" value={k.newCustomers.value} kpi={k.newCustomers} tone="mint" />
        <KpiTile icon={<UserPlus style={ico} />} label="Yeni talep" value={k.newDemands.value} kpi={k.newDemands} tone="rose" />
        <KpiTile icon={<PhoneIncoming style={ico} />} label="Gelen arama" value={k.inboundCalls.value} kpi={k.inboundCalls} tone="sky" />
      </div>
      <Panel
        title="Son 14 gün"
        icon={<Gauge style={ico} />}
        className="tv-chart-panel"
        aside={
          <span className="tv-legend">
            <i data-k="area" /> Yeni talep · {nf.format(sumDem)}
            <i data-k="bar" /> Kazanılan anlaşma · {nf.format(sumWon)}
          </span>
        }
      >
        <AreaBars area={k.newDemands.series} bars={k.wonDeals.series} labels={labels} areaLabel="Yeni talep" barLabel="Kazanılan anlaşma" />
      </Panel>
    </div>
  );
}

/* ================================ 3 · Lig ================================ */

function Podium({ row, rank, money: showMoney }: { row: TvLeagueRow; rank: 1 | 2 | 3; money: boolean }) {
  return (
    <div className="tv-podium-col" data-rank={rank}>
      <div className="tv-podium-avatar">
        {row.targetPct !== null ? (
          <TvRing pct={row.targetPct} label={`${row.name} hedef`} size={140} stroke={7}>
            <span className="sr-only">%{row.targetPct}</span>
          </TvRing>
        ) : null}
        <Avatar name={row.name} src={row.avatarUrl} preset={row.avatarPreset} size="lg" className="tv-avatar-xl" />
        <Medal rank={rank} />
      </div>
      <b className="tv-podium-name">{row.name}</b>
      <span className="tv-podium-score">
        <TvNumber value={row.deals} /> <small>anlaşma</small>
      </span>
      {showMoney && row.revenue !== null ? <span className="tv-podium-money">{money(row.revenue)}</span> : null}
      <span className="tv-podium-meta">
        {row.streak > 1 ? (
          <span className="tv-streak">
            <Flame /> {row.streak} gün
          </span>
        ) : null}
        {row.targetPct !== null ? <span>%{row.targetPct} hedef</span> : null}
      </span>
      <span className="tv-podium-step" aria-hidden>
        {rank}
      </span>
    </div>
  );
}

export function SceneLeague({ data }: SceneProps) {
  const rows = data.league;
  const top = rows.slice(0, 3);
  const rest = rows.slice(3, 10);
  const order = [top[1] ? { r: top[1], k: 2 as const } : null, top[0] ? { r: top[0], k: 1 as const } : null, top[2] ? { r: top[2], k: 3 as const } : null].filter(
    (x): x is { r: TvLeagueRow; k: 1 | 2 | 3 } => x !== null,
  );
  return (
    <div className="tv-scene-body tv-league">
      <SceneHead kicker={`Danışman ligi · ${data.monthLabel}`} title="Ayın yıldızları" lead={rows[0] ? <>Zirvede <b>{rows[0].name}</b> · {nf.format(rows[0].deals)} anlaşma</> : undefined} />
      <div className="tv-league-grid" data-solo={rest.length === 0}>
        <div className="tv-podium">
          {order.map(({ r, k }) => (
            <Podium key={r.id} row={r} rank={k} money={data.moneyVisible} />
          ))}
        </div>
        {rest.length ? (
          <Panel title="Sıralama" icon={<Trophy style={ico} />} className="tv-rank-panel">
            <ol className="tv-rank-list" start={4}>
              {rest.map((r, i) => (
                <li key={r.id} className="tv-rank-row">
                  <span className="tv-rank-no">{i + 4}</span>
                  <Avatar name={r.name} src={r.avatarUrl} preset={r.avatarPreset} size="md" className="tv-avatar-md" />
                  <span className="tv-row-text">
                    {r.name}
                    <small>
                      {nf.format(r.appointments)} randevu{r.streak > 1 ? ` · ${r.streak} gün seri` : ""}
                    </small>
                  </span>
                  {r.targetPct !== null ? (
                    <span className="tv-rank-ring">
                      <TvRing pct={r.targetPct} label={`${r.name} hedef`} size={56} stroke={6} />
                    </span>
                  ) : null}
                  <span className="tv-rank-score">
                    {data.moneyVisible && r.revenue !== null ? money(r.revenue) : nf.format(r.deals)}
                    <small>{data.moneyVisible && r.revenue !== null ? `${nf.format(r.deals)} anlaşma` : "anlaşma"}</small>
                  </span>
                </li>
              ))}
            </ol>
          </Panel>
        ) : null}
      </div>
    </div>
  );
}

/* ============================ 4 · Yeni portföyler ============================ */

export function SceneListings({ data, sceneMs, paused }: SceneProps) {
  const list = data.listings.filter((l) => l.coverSrc);
  const step = perItemMs(sceneMs, list.length, 6000);
  const [i, setI] = useState(0);
  useEffect(() => {
    if (paused || list.length < 2) return;
    const t = setInterval(() => setI((x) => x + 1), step);
    return () => clearInterval(t);
  }, [paused, list.length, step]);
  if (list.length === 0) return null;
  const idx = i % list.length;
  const cur = list[idx];
  const upcoming = [1, 2, 3].map((d) => list[(idx + d) % list.length]).filter((l, k, arr) => l.id !== cur.id && arr.findIndex((x) => x.id === l.id) === k);
  return (
    <div className="tv-listing" style={{ "--kb-ms": `${step + 1200}ms` } as CSSProperties}>
      {list.map((l, k) =>
        k === idx || k === (idx + 1) % list.length ? (
          <img key={l.id} src={l.coverSrc!} alt="" className="tv-listing-photo" data-on={k === idx} data-kb={k % 4} decoding="async" />
        ) : null,
      )}
      <span className="tv-listing-veil" aria-hidden />
      <div className="tv-listing-info" key={cur.id}>
        <span className="tv-kicker">Yeni portföyler</span>
        <div className="tv-listing-badges">
          {cur.badge ? <span className="tv-tag" data-tone={cur.badge === "Yeni" ? "blue" : "gold"}>{cur.badge}</span> : null}
          {cur.transaction ? <span className="tv-tag">{cur.transaction}</span> : null}
          {cur.propertyType ? <span className="tv-tag">{cur.propertyType}</span> : null}
        </div>
        <h2 className="tv-listing-title">{cur.title}</h2>
        <p className="tv-listing-facts">
          {[cur.district, cur.rooms, cur.sqm ? `${nf.format(cur.sqm)} m²` : null].filter(Boolean).join(" · ")}
        </p>
        <p className="tv-listing-price">{cur.price !== null ? money(cur.price, cur.currency) : "Fiyat için ofise danışın"}</p>
      </div>
      {upcoming.length ? (
        <div className="tv-listing-strip" aria-label="Sıradaki portföyler">
          {upcoming.map((l) => (
            <ListingThumb key={l.id} l={l} />
          ))}
          <span className="tv-listing-count">
            {idx + 1} / {list.length}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function ListingThumb({ l }: { l: TvListing }) {
  return (
    <span className="tv-thumb">
      <img src={l.coverSrc!} alt="" loading="lazy" decoding="async" />
      <span>
        <b>{l.price !== null ? money(l.price, l.currency) : l.title}</b>
        <small>{l.district ?? l.propertyType ?? ""}</small>
      </span>
    </span>
  );
}

/* ================================ 5 · Hedefler ================================ */

export function SceneGoals({ data }: SceneProps) {
  const g = data.goals;
  const left = Math.max(0, data.month.days - data.month.day);
  const onTrack = g.projection !== null && g.dealTarget !== null ? g.projection >= g.dealTarget : null;
  const advisors = data.league.filter((r) => r.targetPct !== null).sort((a, b) => (b.targetPct ?? 0) - (a.targetPct ?? 0)).slice(0, 5);
  return (
    <div className="tv-scene-body tv-goals">
      <SceneHead kicker={`Hedefler · ${data.monthLabel}`} title="Hedefe yolculuk" lead={`Ay sonuna ${left} gün`} />
      <div className="tv-goals-grid">
        <div className="tv-glass tv-goal-hero">
          {g.dealTarget ? (
            <TvRing pct={g.dealPct ?? 0} label="Ofis anlaşma hedefi" size={260} stroke={18}>
              <span className="tv-goal-pct">%{g.dealPct ?? 0}</span>
            </TvRing>
          ) : (
            <span className="tv-goal-noring">
              <Target style={ico} />
            </span>
          )}
          <div className="tv-goal-text">
            <span className="tv-kpi-label">Ofis anlaşma hedefi</span>
            <span className="tv-goal-big">
              <TvNumber value={g.deals} />
              {g.dealTarget ? <small> / {nf.format(g.dealTarget)}</small> : null}
            </span>
            {g.projection !== null ? (
              <span className="tv-goal-pace" data-tone={onTrack === false ? "warn" : "good"}>
                Bu hızla ay sonu ≈ <b>{nf.format(g.projection)}</b> anlaşma
                <small>tahmin</small>
              </span>
            ) : null}
            {data.moneyVisible && g.revenue !== null ? (
              <span className="tv-goal-money">
                {money(g.revenue)}
                {g.revenueTarget ? <small> / {money(g.revenueTarget)} ciro</small> : <small> ciro</small>}
              </span>
            ) : null}
          </div>
        </div>
        <div className="tv-goals-side">
          {g.branches.length ? (
            <Panel title="Şube hedefleri" icon={<Building2 style={ico} />}>
              <ul className="tv-bars">
                {g.branches.map((b) => (
                  <li key={b.id}>
                    <span className="tv-bar-head">
                      <b>{b.name}</b>
                      <span>
                        {nf.format(b.deals)} / {nf.format(b.target)} · %{b.pct}
                      </span>
                    </span>
                    <span className="tv-bar">
                      <i style={{ transform: `scaleX(${Math.min(1, b.pct / 100)})` }} />
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
          {advisors.length ? (
            <Panel title="Danışman hedefleri" icon={<Award style={ico} />}>
              <ul className="tv-ring-grid">
                {advisors.map((r) => (
                  <li key={r.id}>
                    <TvRing pct={r.targetPct ?? 0} label={`${r.name} hedef`} size={110} stroke={9}>
                      <span className="tv-ring-label">%{r.targetPct}</span>
                    </TvRing>
                    <b>{r.name}</b>
                    <small>
                      {nf.format(r.deals)}
                      {r.targetDeals ? ` / ${nf.format(r.targetDeals)}` : ""} anlaşma
                    </small>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ========================= 6 · Duyurular & kutlamalar ========================= */

export function SceneNews({ data, nowMs }: SceneProps) {
  const anns = data.announcements.slice(0, 3);
  const hasCelebrations = data.wins.length + data.anniversaries.length + data.badges.length > 0;
  return (
    <div className="tv-scene-body tv-news">
      <SceneHead kicker="Duyurular ve kutlamalar" title="Ofisten haberler" />
      <div className="tv-news-grid" data-solo={!anns.length || !hasCelebrations}>
        {anns.length ? (
          <div className="tv-ann-list">
            {anns.map((a) => (
              <article key={a.id} className="tv-glass tv-ann" data-level={a.level}>
                <h3>
                  {a.pinned ? <Pin style={ico} aria-label="Sabitlenmiş" /> : <Megaphone style={ico} aria-hidden />}
                  {a.title}
                </h3>
                {a.body ? <p>{a.body}</p> : null}
              </article>
            ))}
          </div>
        ) : null}
        {hasCelebrations ? (
          <Panel title="Kutlamalar" icon={<BellRing style={ico} />} className="tv-cele-panel">
            <ul className="tv-rows tv-cele">
              {data.wins.slice(0, 4).map((w) => (
                <li key={w.id} className="tv-row-line" data-kind="win">
                  <span className="tv-cele-ico" aria-hidden>
                    <Trophy style={ico} />
                  </span>
                  <span className="tv-row-text">
                    Satış kapandı{w.advisor ? ` · ${w.advisor}` : ""}
                    <small>{[w.district, w.propertyType].filter(Boolean).join(" · ") || "Tebrikler ekip"}</small>
                  </span>
                  <span className="tv-row-meta">{fmtAgo(w.at, nowMs)}</span>
                </li>
              ))}
              {data.anniversaries.map((a) => (
                <li key={a.id} className="tv-row-line" data-kind="anniversary">
                  <span className="tv-cele-ico" aria-hidden>
                    <Award style={ico} />
                  </span>
                  <span className="tv-row-text">
                    {a.name} · {a.years}. yıl
                    <small>Ekipteki iş yıldönümü</small>
                  </span>
                  <span className="tv-row-meta">{a.today ? "bugün" : "bu hafta"}</span>
                </li>
              ))}
              {data.badges.slice(0, 3).map((b) => (
                <li key={b.id} className="tv-row-line" data-kind="badge">
                  <span className="tv-cele-ico" aria-hidden>
                    <MedalIcon style={ico} />
                  </span>
                  <span className="tv-row-text">
                    {b.name}
                    <small>{b.badge} rozeti</small>
                  </span>
                  <span className="tv-row-meta">{fmtAgo(b.at, nowMs)}</span>
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}
      </div>
    </div>
  );
}

/* ========================= 7 · Portal ve sistem ========================= */

export function SceneSystem({ data, device, live, updatedAt, nowMs }: SceneProps) {
  const h = data.health;
  const ageSec = updatedAt ? Math.max(0, Math.round((nowMs - updatedAt) / 1000)) : null;
  return (
    <div className="tv-scene-body tv-system">
      <SceneHead kicker="Portal ve sistem" title="Her şey yolunda mı?" lead={h.overdueListings > 0 ? `${nf.format(h.overdueListings)} ilanın teyidi gecikti` : "İlan teyitleri güncel"} />
      <div className="tv-system-grid">
        <div className="tv-glass tv-sys-health">
          {h.healthPct !== null ? (
            <TvRing pct={h.healthPct} label="İlan teyit sağlığı" size={200} stroke={14}>
              <span className="tv-goal-pct">%{Math.round(h.healthPct)}</span>
            </TvRing>
          ) : (
            <span className="tv-goal-noring">
              <Radio style={ico} />
            </span>
          )}
          <span className="tv-kpi-label">Teyidi güncel ilan</span>
          <b className="tv-sys-big">
            {nf.format(h.liveListings - h.overdueListings)} / {nf.format(h.liveListings)}
          </b>
        </div>
        <div className="tv-sys-portals">
          {h.portals.length ? (
            h.portals.map((p) => (
              <div key={p.id} className="tv-glass tv-sys-portal" data-ok={p.overdue === 0}>
                <span className="tv-kpi-label">{p.label}</span>
                <b>{nf.format(p.live)}</b>
                <small>{p.overdue > 0 ? `${nf.format(p.overdue)} teyit bekliyor` : "yayında · teyit güncel"}</small>
              </div>
            ))
          ) : (
            <TvEmpty icon={<Bell style={ico} />} text="Portalda yayında ilan yok" hint="Portal aktarımı yapıldığında burada izlenir" />
          )}
        </div>
        <div className="tv-glass tv-sys-conn">
          <span className="tv-kpi-label">Bağlantı</span>
          <b>
            <Wifi style={ico} aria-hidden /> {live === "realtime" ? "Canlı · anlık" : `Yoklama · ${device ? "20" : "60"} sn`}
          </b>
          <small>{ageSec !== null ? `Son veri ${ageSec < 60 ? `${ageSec} sn` : `${Math.round(ageSec / 60)} dk`} önce` : "Bekleniyor"}</small>
          <small>{device ? "Eşleşmiş ofis ekranı · salt okunur" : "Oturumlu pano"}</small>
          {data.degraded ? <small className="tv-warn-text">Bazı sayılar eksik olabilir</small> : null}
        </div>
      </div>
    </div>
  );
}

/* ============================ Kutlama katmanı ============================ */

export function CelebrationOverlay({ win, monthDeals, reduced }: { win: TvData["wins"][number]; monthDeals: number; reduced: boolean }) {
  return (
    <div className="tv-celebrate" role="status" aria-live="polite">
      {reduced ? null : <Confetti />}
      <div className="tv-celebrate-card tv-glass">
        <span className="tv-celebrate-medal" aria-hidden>
          <Trophy style={ico} />
        </span>
        <span className="tv-kicker">Tebrikler</span>
        <h2>Satış kapandı!</h2>
        <p>
          {[win.advisor, win.district, win.propertyType].filter(Boolean).join(" · ") || "Ekibe tebrikler"}
        </p>
        <small>Bu ay {nf.format(monthDeals)}. anlaşma</small>
      </div>
    </div>
  );
}
