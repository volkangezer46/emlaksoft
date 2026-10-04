"use client";

/* eslint-disable @next/next/no-img-element -- portföy kapakları oturumlu indirme ucundan gelir; next/image optimizasyonu gerekmez */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CalendarClock,
  Building2,
  UserPlus,
  Sparkles,
  Gauge,
  LogOut,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Radio,
  Settings2,
  SunMoon,
  Trophy,
  Users,
  WifiOff,
} from "lucide-react";
import { Brand } from "@/components/brand/brand";
import { Celebration } from "@/components/ui/illustrations";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { now, trParts } from "@/lib/clock";
import type { TvData } from "@/lib/tv/tv-data";
import {
  ROTATION_OPTIONS,
  TV_SECTIONS,
  TV_SECTION_LABELS,
  TV_TEMPLATES,
  burnInOffset,
  canShowRevenue,
  isSectionVisible,
  newIds,
  pageAt,
  resolveTvDark,
  shouldCelebrate,
  type TvSection,
  type TvSettings,
  type TvTheme,
} from "@/lib/tv/tv-logic";
import { useClock, useReducedMotion, useRotation, useSystemDark, useTvData, useTvSettings, useWakeLock } from "./tv-hooks";

const nf = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 });
const compactMoney = (n: number) =>
  n >= 1_000_000 ? `₺${(n / 1_000_000).toFixed(1).replace(".", ",")} Mn` : n >= 1_000 ? `₺${nf.format(Math.round(n / 1_000))} B` : `₺${nf.format(n)}`;

const DAYS_TR = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];
const MONTHS_TR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Sayı geçişi: tamsayılar hane hane akar (@number-flow/react, TEMBEL parça; hareket azaltmada düz metin).
 * `format` verilirse (kısaltılmış para gibi) düz metin yazılır — nadiren değişir, DOM hafif kalır.
 */
function TvNumber({ value, format }: { value: number; format?: (n: number) => string }) {
  if (format) return <>{format(value)}</>;
  return <AnimatedNumber value={value} />;
}

function Pager({ page, pages }: { page: number; pages: number }) {
  if (pages <= 1) return null;
  return (
    <span className="tv-pager" aria-label={`Sayfa ${page + 1} / ${pages}`}>
      {Array.from({ length: pages }, (_, i) => (
        <i key={i} data-on={i === page} />
      ))}
    </span>
  );
}

function Card({ title, icon, className = "", pager, children }: { title: string; icon: ReactNode; className?: string; pager?: ReactNode; children: ReactNode }) {
  return (
    <section className={`tv-card ${className}`} aria-label={title}>
      <h2 className="tv-card-title">
        {icon}
        {title}
        {pager}
      </h2>
      {children}
    </section>
  );
}

const STATUS_LABEL: Record<string, string> = { pending: "Bekliyor", confirmed: "Onaylı", signature: "İmza", completed: "Tamamlandı" };

export function TvBoard({ tenantId, officeName }: { tenantId: string; officeName: string }) {
  const [settings, updateSettings] = useTvSettings(tenantId);
  const [paused, setPaused] = useState(false);
  const { data, status, updatedAt, reload } = useTvData(tenantId, settings.showRevenue);
  const tick = useRotation(paused, settings.rotationSec);
  const clock = useClock();
  const reduced = useReducedMotion();
  const systemDark = useSystemDark();
  const dark = resolveTvDark(settings.theme, systemDark);

  const rootRef = useRef<HTMLDivElement>(null);
  const [fs, setFs] = useState(false);
  const [idle, setIdle] = useState(false);
  const [panel, setPanel] = useState(false);
  const exitedByUser = useRef(false);
  const [celebrate, setCelebrate] = useState(false);
  const prevWon = useRef<number | null>(null);
  const prevIds = useRef<{ appt: Set<string>; prop: Set<string>; ev: Set<string> } | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);

  useWakeLock(true);

  // Kabuğu örten katman: gövde kaydırması kapalı
  useEffect(() => {
    document.documentElement.classList.add("tv-active");
    return () => document.documentElement.classList.remove("tv-active");
  }, []);

  // Kiosk: uygulama kabuğu (menü, üst şerit, sayfa içeriği) TV katmanının altında kalır; odak ve ekran
  // okuyucu oraya gidemesin diye kardeş öğeler `inert` yapılır (çıkışta eski hâl geri gelir).
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const touched: Element[] = [];
    for (let el: Element | null = root; el && el !== document.body; el = el.parentElement) {
      for (const sib of Array.from(el.parentElement?.children ?? [])) {
        if (sib === el || sib.hasAttribute("inert") || sib.tagName === "SCRIPT" || sib.tagName === "STYLE") continue;
        sib.setAttribute("inert", "");
        touched.push(sib);
      }
    }
    return () => touched.forEach((el) => el.removeAttribute("inert"));
  }, []);

  // Tam ekran durumu + imleç gizleme (tam ekranda 3 sn hareketsizlik)
  useEffect(() => {
    const onFs = () => {
      const on = Boolean(document.fullscreenElement);
      setFs((was) => {
        if (was && !on) exitedByUser.current = true;
        return on;
      });
      if (!on) setIdle(false);
    };
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  useEffect(() => {
    if (!fs) return;
    let t: ReturnType<typeof setTimeout>;
    const arm = () => {
      setIdle(false);
      clearTimeout(t);
      t = setTimeout(() => setIdle(true), 3000);
    };
    arm();
    window.addEventListener("mousemove", arm);
    window.addEventListener("pointerdown", arm);
    window.addEventListener("keydown", arm);
    return () => {
      clearTimeout(t);
      window.removeEventListener("mousemove", arm);
      window.removeEventListener("pointerdown", arm);
      window.removeEventListener("keydown", arm);
    };
  }, [fs]);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await (rootRef.current ?? document.documentElement).requestFullscreen();
    } catch {
      /* tarayıcı engelledi: F11 ipucu görünür kalır */
    }
  }, []);

  // İlk tıklamada tam ekran (tarayıcı kullanıcı eylemi şart koşar); Esc ile çıkıldıysa tekrar zorlanmaz
  const onRootClick = () => {
    if (!document.fullscreenElement && !exitedByUser.current) void toggleFullscreen();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (e.key === "f" || e.key === "F") void toggleFullscreen();
      else if (e.key === "p" || e.key === "P") setPaused((p) => !p);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleFullscreen]);

  // Yeni öğe vurgusu + anlaşma kutlaması (her veri yenilenmesinde)
  useEffect(() => {
    if (!data) return;
    const ids = {
      appt: new Set(data.appointments.map((a) => a.id)),
      prop: new Set(data.properties.map((p) => p.id)),
      ev: new Set(data.events.map((e) => e.id)),
    };
    const prev = prevIds.current;
    const added = new Set<string>([
      ...newIds(prev?.appt ?? null, [...ids.appt]),
      ...newIds(prev?.prop ?? null, [...ids.prop]),
      ...newIds(prev?.ev ?? null, [...ids.ev]),
    ]);
    prevIds.current = ids;
    let clear: ReturnType<typeof setTimeout> | undefined;
    let toastTimer: ReturnType<typeof setTimeout> | undefined;
    if (added.size) {
      setFresh(added);
      clear = setTimeout(() => setFresh(new Set()), 6000);
      // İnce bildirim: yeni kayıt anında köşede kısa süre görünür (tam ekran kutlama yalnız kazanılan anlaşmada)
      const first = data.events.find((e) => added.has(e.id));
      if (first) {
        setToast(first.label);
        toastTimer = setTimeout(() => setToast(null), 5000);
      }
    }
    let stop: ReturnType<typeof setTimeout> | undefined;
    if (shouldCelebrate(prevWon.current, data.goal.deals)) {
      setCelebrate(true);
      stop = setTimeout(() => setCelebrate(false), 9000);
    }
    prevWon.current = data.goal.deals;
    return () => {
      if (clear) clearTimeout(clear);
      if (stop) clearTimeout(stop);
      if (toastTimer) clearTimeout(toastTimer);
    };
  }, [data]);

  const showRev = data ? canShowRevenue(settings, data.revenueVisible) : false;
  const minute = clock ? Math.floor(clock / 60_000) : 0;
  const shift = burnInOffset(minute);
  const vis = (s: TvSection) => isSectionVisible(settings, s);

  const clockParts = clock ? trParts(clock) : null;
  const seconds = clock ? Math.floor(clock / 1000) % 60 : 0;

  return (
    <div
      ref={rootRef}
      className="tv-root"
      data-tv-root
      data-tv-dark={dark}
      data-tv-idle={idle}
      onClick={onRootClick}
    >
      <div className="tv-shift" style={{ transform: reduced ? undefined : `translate(${shift.x}px, ${shift.y}px)` }}>
        <header className="tv-head">
          <Brand variant="mark" tone={dark ? "dark" : "light"} height={56} alt="" />
          <div style={{ minWidth: 0 }}>
            <div className="tv-head-name">{officeName}</div>
            <div className="tv-head-sub">
              Canlı Ofis Panosu{data ? ` · ${data.monthLabel}` : ""}
              {data?.sampleIncluded ? <span className="tv-sample">Örnek veri içerir</span> : null}
            </div>
          </div>
          <div className="tv-head-spacer" />
          <span className="tv-badge" data-state={status === "ok" ? "live" : status === "loading" ? "live" : "offline"} role="status">
            {status === "ok" || status === "loading" ? (
              <>
                <span className="tv-dot" /> Canlı
                {updatedAt ? ` · ${pad(trParts(updatedAt).hour)}:${pad(trParts(updatedAt).minute)}` : ""}
              </>
            ) : (
              <>
                <WifiOff style={{ width: "1.2em", height: "1.2em" }} aria-hidden /> Bağlantı yok · yeniden deneniyor
              </>
            )}
          </span>
          <div>
            <div className="tv-clock" suppressHydrationWarning>
              {clockParts ? `${pad(clockParts.hour)}:${pad(clockParts.minute)}` : "--:--"}
              <span style={{ fontSize: "0.45em", opacity: 0.6 }}>:{clockParts ? pad(seconds) : "--"}</span>
            </div>
            <div className="tv-date" suppressHydrationWarning>
              {clockParts ? `${clockParts.day} ${MONTHS_TR[clockParts.month]} ${clockParts.year} · ${DAYS_TR[clockParts.weekday]}` : ""}
            </div>
          </div>
        </header>

        <main className="tv-grid">
          {data ? <Sections data={data} settings={settings} tick={tick} showRev={showRev} vis={vis} fresh={fresh} /> : null}
        </main>

        {data && vis("ticker") && data.announcements.length > 0 ? <Ticker items={data.announcements} reduced={reduced} tick={tick} /> : null}
      </div>

      {!data && status === "loading" ? (
        <div className="tv-overlay" role="status">
          <h2>Pano hazırlanıyor…</h2>
        </div>
      ) : null}

      {celebrate ? (
        <div className="tv-celebrate" role="status" aria-live="polite">
          <span className="tv-confetti" aria-hidden>
            {Array.from({ length: 36 }, (_, i) => (
              <i key={i} style={{ "--i": i } as React.CSSProperties} />
            ))}
          </span>
          <Celebration />
          <h2>Yeni anlaşma kazanıldı!</h2>
          <p>Bu ay {data ? nf.format(data.goal.deals) : ""} anlaşma · ekibe tebrikler</p>
        </div>
      ) : null}

      {toast && !celebrate ? (
        <div className="tv-toast" role="status" aria-live="polite" key={toast}>
          <Sparkles style={{ width: "1.2em", height: "1.2em" }} aria-hidden /> {toast}
        </div>
      ) : null}

      {status === "session" && data ? (
        <div className="tv-session" role="alert">
          <span>Oturum süresi doldu; pano son verileri gösteriyor.</span>
          {/* Oturum bittiği için tam sayfa yenileme isteniyor; Link ile istemci geçişi oturumu tazelemez. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a className="tv-btn" data-primary="true" href="/giris?next=/app/pano-tv">
            Yeniden giriş yap
          </a>
        </div>
      ) : null}

      {status === "session" && !data ? (
        <div className="tv-overlay" role="alert">
          <h2>Oturum süresi doldu</h2>
          <p>Panoyu sürdürmek için yeniden giriş yapın.</p>
          {/* Oturum bittiği için tam sayfa yenileme isteniyor; Link ile istemci geçişi oturumu tazelemez. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a className="tv-btn" data-primary="true" href="/giris?next=/app/pano-tv">
            Yeniden giriş yap
          </a>
        </div>
      ) : null}

      {status === "forbidden" ? (
        <div className="tv-overlay" role="alert">
          <h2>Bu panoyu görme yetkiniz yok</h2>
          <p>Ofis Panosu yalnız ofis geneli kapsamı olan roller içindir.</p>
          <Link className="tv-btn" href="/app">
            Panele dön
          </Link>
        </div>
      ) : null}

      {!fs ? (
        <div className="tv-hint" aria-hidden>
          Tam ekran için ekrana bir kez tıklayın ya da F11 / F tuşuna basın
        </div>
      ) : null}

      <div className="tv-tools" role="toolbar" aria-label="TV araçları">
        <button type="button" className="tv-btn" onClick={() => void toggleFullscreen()} aria-pressed={fs} title="Tam ekran (F)">
          {fs ? <Minimize2 style={{ width: "1.2em", height: "1.2em" }} aria-hidden /> : <Maximize2 style={{ width: "1.2em", height: "1.2em" }} aria-hidden />}
          {fs ? "Tam ekrandan çık" : "Tam ekran"}
        </button>
        <button
          type="button"
          className="tv-btn"
          onClick={() => {
            const order: TvTheme[] = ["auto", "light", "dark"];
            updateSettings({ theme: order[(order.indexOf(settings.theme) + 1) % order.length] });
          }}
          title="Tema: otomatik / açık / koyu"
        >
          <SunMoon style={{ width: "1.2em", height: "1.2em" }} aria-hidden />
          {settings.theme === "auto" ? "Otomatik" : settings.theme === "light" ? "Açık" : "Koyu"}
        </button>
        <button type="button" className="tv-btn" onClick={() => setPaused((p) => !p)} aria-pressed={paused} title="Sayfa dönüşümünü duraklat (P)">
          {paused ? <Play style={{ width: "1.2em", height: "1.2em" }} aria-hidden /> : <Pause style={{ width: "1.2em", height: "1.2em" }} aria-hidden />}
          {paused ? "Devam" : "Duraklat"}
        </button>
        <button type="button" className="tv-btn" onClick={() => setPanel((o) => !o)} aria-expanded={panel} title="TV ayarları">
          <Settings2 style={{ width: "1.2em", height: "1.2em" }} aria-hidden /> Ayarlar
        </button>
        <button type="button" className="tv-btn" onClick={() => void reload()} title="Şimdi yenile">
          <Radio style={{ width: "1.2em", height: "1.2em" }} aria-hidden /> Yenile
        </button>
        <Link href="/app" className="tv-btn" title="TV modundan çık">
          <LogOut style={{ width: "1.2em", height: "1.2em" }} aria-hidden /> Çıkış
        </Link>
      </div>

      {panel ? <SettingsPanel settings={settings} update={updateSettings} onClose={() => setPanel(false)} revenueAllowed={data?.revenueVisible ?? null} /> : null}
    </div>
  );
}

function Sections({
  data,
  settings,
  tick,
  showRev,
  vis,
  fresh,
}: {
  data: TvData;
  settings: TvSettings;
  tick: number;
  showRev: boolean;
  vis: (s: TvSection) => boolean;
  fresh: Set<string>;
}) {
  const appts = useMemo(() => pageAt(data.appointments, 6, tick), [data.appointments, tick]);
  const league = useMemo(() => pageAt(data.league, 6, tick), [data.league, tick]);
  // Tek hücrelik kartlar 3'er satır sayfalar (büyük yazı sığsın)
  const events = useMemo(() => pageAt(data.events, 3, tick), [data.events, tick]);
  const leads = useMemo(() => pageAt(data.leads, 3, tick), [data.leads, tick]);
  // Alt orta hücre dönüşümlü: canlı akış ↔ yeni portföyler (her rotasyonda biri)
  const rotor = (["events", "properties"] as const).filter((k) => vis(k));
  const rotorNow = rotor.length ? rotor[Math.floor(tick) % rotor.length] : null;
  const { goal, stats, alerts } = data;
  const sales = settings.template === "satis";
  const ringR = 42;
  const circ = 2 * Math.PI * ringR;
  const pct = goal.dealPct ?? 0;

  return (
    <>
      {vis("appointments") ? (
        <Card title="Bugünün randevuları" icon={<CalendarClock style={{ width: "1.3em", height: "1.3em" }} aria-hidden />} className="tv-span2" pager={<Pager page={appts.page} pages={appts.pages} />}>
          {appts.slice.length === 0 ? (
            <p className="tv-empty">Bugün için planlı randevu yok.</p>
          ) : (
            <ul className="tv-list" key={appts.page}>
              {appts.slice.map((a) => (
                <li key={a.id} className="tv-row" data-fresh={fresh.has(a.id)}>
                  <span className="tv-time">{a.time}</span>
                  <span className="tv-row-main">
                    <b>{a.customer}</b>
                    <span className="tv-row-sub">
                      {a.advisor}
                      {STATUS_LABEL[a.status] ? ` · ${STATUS_LABEL[a.status]}` : ""}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      {vis("goal") ? (
        <Card title={`Aylık hedef · ${data.monthLabel}`} icon={<Gauge style={{ width: "1.3em", height: "1.3em" }} aria-hidden />}>
          <div className="tv-goal">
            {goal.dealTarget ? (
              <div className="tv-ring" role="img" aria-label={`Anlaşma hedefi yüzde ${pct}`}>
                <svg viewBox="0 0 100 100" aria-hidden>
                  <circle className="tv-ring-bg" cx="50" cy="50" r={ringR} />
                  <circle className="tv-ring-fg" cx="50" cy="50" r={ringR} strokeDasharray={circ} strokeDashoffset={circ * (1 - pct / 100)} />
                </svg>
                <div className="tv-ring-label">
                  <AnimatedNumber value={pct} kind="percent" />
                </div>
              </div>
            ) : null}
            <div style={{ minWidth: 0 }}>
              <div className="tv-big">
                <TvNumber value={goal.deals} />
                {goal.dealTarget ? <span className="tv-cap"> / {nf.format(goal.dealTarget)}</span> : null}
              </div>
              <div className="tv-cap">kabul edilen anlaşma</div>
              {!goal.dealTarget ? <div className="tv-cap">Ofis hedefi tanımlı değil</div> : null}
              {showRev && goal.revenue !== null ? (
                <div style={{ marginTop: "0.6em" }}>
                  <div className="tv-num">
                    <TvNumber value={goal.revenue} format={compactMoney} />
                    {goal.revenueTarget ? <span className="tv-cap"> / {compactMoney(goal.revenueTarget)}</span> : null}
                  </div>
                  <div className="tv-cap">ofis komisyonu (brüt)</div>
                </div>
              ) : null}
            </div>
          </div>
        </Card>
      ) : null}

      {vis("league") ? (
        <Card title="Danışman ligi · bu ay" icon={<Trophy style={{ width: "1.3em", height: "1.3em" }} aria-hidden />} className="tv-span2" pager={<Pager page={league.page} pages={league.pages} />}>
          {league.slice.length === 0 ? (
            <p className="tv-empty">Bu ay henüz kayıt yok.</p>
          ) : (
            <ol className="tv-list" key={league.page}>
              {league.slice.map((r, i) => {
                const rank = league.page * 6 + i + 1;
                return (
                  <li key={r.id} className="tv-row">
                    <span className="tv-rank" data-top={rank <= 3 ? rank : undefined}>
                      {rank}
                    </span>
                    <span className="tv-row-main">
                      <b>{r.name}</b>
                      <span className="tv-row-sub">
                        {r.appointments} randevu{r.conversionPct !== null ? ` · %${Math.round(r.conversionPct)} dönüşüm` : ""}
                      </span>
                    </span>
                    <span style={{ textAlign: "right" }}>
                      <span className="tv-num">
                        {showRev && r.revenue !== null ? compactMoney(r.revenue) : <TvNumber value={r.deals} />}
                      </span>
                      <span className="tv-row-sub" style={{ display: "block" }}>
                        {showRev && r.revenue !== null ? `${r.deals} satış` : "satış"}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </Card>
      ) : null}

      {vis("stats") ? (
        <Card title="Talep ve müşteri" icon={<Users style={{ width: "1.3em", height: "1.3em" }} aria-hidden />}>
          <div className="tv-stats">
            <Stat label="Aktif talep" value={stats.activeDemands} />
            <Stat label="Yeni müşteri · ay" value={stats.newCustomers} />
            <Stat label="Açık fırsat" value={stats.openDeals} />
            <Stat label={sales ? "Bugün kazanılan" : "Randevu · ay"} value={sales ? stats.wonToday : stats.monthAppointments} tone={sales && stats.wonToday > 0 ? "good" : undefined} />
          </div>
        </Card>
      ) : null}

      {vis("leads") ? (
        <Card title="Yeni talepler" icon={<UserPlus style={{ width: "1.3em", height: "1.3em" }} aria-hidden />} pager={<Pager page={leads.page} pages={leads.pages} />}>
          {leads.slice.length === 0 ? (
            <p className="tv-empty">Henüz yeni talep yok.</p>
          ) : (
            <ul className="tv-list" key={leads.page}>
              {leads.slice.map((l) => (
                <li key={l.id} className="tv-row" data-fresh={fresh.has(`customer:${l.id}`)}>
                  <span className="tv-row-main">
                    <b>{l.name}</b>
                    {l.source ? <span className="tv-row-sub">{l.source}</span> : null}
                  </span>
                  <span className="tv-row-sub" suppressHydrationWarning>
                    {fmtAgo(l.at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      {vis("alerts") ? (
        <Card title="Geciken / riskli" icon={<AlertTriangle style={{ width: "1.3em", height: "1.3em" }} aria-hidden />}>
          <div className="tv-stats">
            <Stat label="Geciken görev" value={alerts.overdueTasks} tone={alerts.overdueTasks ? "warn" : "good"} />
            <Stat label="Takipsiz talep" value={alerts.untrackedDemands} tone={alerts.untrackedDemands ? "warn" : "good"} />
            <Stat label="Kaçan komisyon · ay" value={alerts.leakCount} tone={alerts.leakCount ? "bad" : "good"} />
          </div>
        </Card>
      ) : null}

      {rotorNow === "events" ? (
        <Card title="Canlı akış" icon={<Radio style={{ width: "1.3em", height: "1.3em" }} aria-hidden />} pager={<Pager page={events.page} pages={events.pages} />}>
          {events.slice.length === 0 ? (
            <p className="tv-empty">Henüz hareket yok.</p>
          ) : (
            <ul className="tv-list" key={events.page}>
              {events.slice.map((e) => (
                <li key={e.id} className="tv-row" data-fresh={fresh.has(e.id)}>
                  <span className="tv-row-main">
                    <b>{e.label}</b>
                  </span>
                  <span className="tv-row-sub" suppressHydrationWarning>
                    {fmtAgo(e.at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      {rotorNow === "properties" ? (
        <Card title="Yeni portföyler" icon={<Building2 style={{ width: "1.3em", height: "1.3em" }} aria-hidden />}>
          {data.properties.length === 0 ? (
            <p className="tv-empty">Henüz portföy yok.</p>
          ) : (
            <div className="tv-props">
              {data.properties.map((p) => (
                <div key={p.id} className="tv-prop" data-fresh={fresh.has(p.id)}>
                  {p.coverSrc ? <img src={p.coverSrc} alt="" loading="lazy" /> : null}
                  <div className="tv-prop-cap">
                    <b>{p.price !== null ? compactMoney(p.price) : "—"}</b>
                    <span>{p.title}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      ) : null}
    </>
  );
}

function fmtAgo(iso: string): string {
  const mins = Math.max(0, Math.round((now() - Date.parse(iso)) / 60_000));
  if (mins < 1) return "şimdi";
  if (mins < 60) return `${mins} dk önce`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} sa önce`;
  return `${Math.round(h / 24)} gün önce`;
}

function Stat({ label, value, tone }: { label: string; value: number | null; tone?: "warn" | "bad" | "good" }) {
  return (
    <div className="tv-stat" data-tone={tone}>
      <span className="tv-num">{value === null ? "—" : <TvNumber value={value} />}</span>
      <span className="tv-cap">{label}</span>
    </div>
  );
}

function Ticker({ items, reduced, tick }: { items: string[]; reduced: boolean; tick: number }) {
  const text = items.join("   •   ");
  // Kayan şerit hızı metin uzunluğuna bağlı (okunabilir sabit hız)
  const seconds = Math.max(25, Math.round(text.length * 0.35));
  return (
    <div className="tv-ticker" role="marquee" aria-label="Duyurular">
      <b>DUYURU</b>
      {reduced ? (
        <span className="tv-ticker-static">{items[tick % items.length]}</span>
      ) : (
        <span style={{ overflow: "hidden", flex: 1 }}>
          <span className="tv-ticker-track" style={{ "--tv-marquee": `${seconds}s` } as React.CSSProperties}>
            <span>{text}</span>
          </span>
        </span>
      )}
    </div>
  );
}

function SettingsPanel({
  settings,
  update,
  onClose,
  revenueAllowed,
}: {
  settings: TvSettings;
  update: (p: Partial<TvSettings>) => void;
  onClose: () => void;
  revenueAllowed: boolean | null;
}) {
  const toggleSection = (s: TvSection) =>
    update({ hidden: settings.hidden.includes(s) ? settings.hidden.filter((h) => h !== s) : [...settings.hidden, s] });
  return (
    <div className="tv-panel" role="dialog" aria-label="TV ayarları" onClick={(e) => e.stopPropagation()}>
      <h3>TV ayarları</h3>
      <small>Bu cihaza kaydedilir.</small>
      <fieldset style={{ marginTop: "0.8em" }}>
        <legend className="tv-cap">Şablon</legend>
        {TV_TEMPLATES.map((t) => (
          <label key={t.value}>
            <input type="radio" name="tv-template" checked={settings.template === t.value} onChange={() => update({ template: t.value })} />
            {t.label}
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend className="tv-cap">Tema</legend>
        {(["auto", "light", "dark"] as const).map((t) => (
          <label key={t}>
            <input type="radio" name="tv-theme" checked={settings.theme === t} onChange={() => update({ theme: t })} />
            {t === "auto" ? "Otomatik (sistem)" : t === "light" ? "Açık" : "Koyu"}
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend className="tv-cap">Sayfa dönüş süresi</legend>
        {ROTATION_OPTIONS.map((sec) => (
          <label key={sec}>
            <input type="radio" name="tv-rotation" checked={settings.rotationSec === sec} onChange={() => update({ rotationSec: sec })} />
            {sec} saniye
          </label>
        ))}
        <small>Liste sayfaları ve alt hücredeki canlı akış / portföy kartı bu sürede bir değişir.</small>
      </fieldset>
      <fieldset>
        <legend className="tv-cap">Bölümler</legend>
        {TV_SECTIONS.filter((s) => s !== "ticker").map((s) => (
          <label key={s}>
            <input type="checkbox" checked={!settings.hidden.includes(s)} onChange={() => toggleSection(s)} />
            {TV_SECTION_LABELS[s]}
          </label>
        ))}
        <label>
          <input type="checkbox" checked={settings.ticker} onChange={(e) => update({ ticker: e.target.checked })} />
          Kayan duyuru şeridi
        </label>
      </fieldset>
      <fieldset>
        <legend className="tv-cap">Gelir</legend>
        <label>
          <input type="checkbox" checked={settings.showRevenue} onChange={(e) => update({ showRevenue: e.target.checked })} />
          TV&apos;de gelir göster
        </label>
        <small>
          Varsayılan kapalı. Odadaki herkes görür; açsanız bile yalnız “tüm kazançları görme” iznine sahip hesapta çalışır
          {settings.showRevenue && revenueAllowed === false ? " (bu hesapta izin yok, gelir gösterilmiyor)." : "."}
        </small>
      </fieldset>
      <button type="button" className="tv-btn" onClick={onClose}>
        Kapat
      </button>
    </div>
  );
}
