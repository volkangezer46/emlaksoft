"use client";

/* eslint-disable @next/next/no-img-element -- ofis logosu ve kapaklar dış/korumalı uçtan; next/image TV'de gerekmez */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "@/components/ui/smart-link";
import dynamic from "next/dynamic";
import {
  ChevronLeft,
  ChevronRight,
  Cloud,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  LogOut,
  Maximize2,
  Minimize2,
  MonitorSmartphone,
  Pause,
  Play,
  Settings2,
  Sparkles,
  Sun,
  WifiOff,
} from "lucide-react";
import { Brand } from "@/components/brand/brand";
import { trParts } from "@/lib/clock";
import type { TvData } from "@/lib/tv/tv-data";
import type { WeatherKind } from "@/lib/weather";
import {
  DEFAULT_TV_CONFIG,
  TV_SCENE_META,
  burnInOffset,
  isNightHour,
  newIds,
  planScenes,
  stepIndex,
  type TvSceneId,
} from "@/lib/tv/tv-logic";
import { DEVICE_TV_SOURCE, SESSION_TV_SOURCE, useClock, useDailyReload, useReducedMotion, useSceneRotation, useTvData, useWakeLock } from "./tv-hooks";
import {
  CelebrationOverlay,
  SceneBackdrop,
  SceneGoals,
  SceneLeague,
  SceneListings,
  SceneNews,
  ScenePerformance,
  SceneSystem,
  SceneToday,
  type SceneProps,
} from "./tv-scenes";

// Paneller yalnız yönetici açınca yüklenir: pano ilk yükünü büyütmez.
const TvDevicesPanel = dynamic(() => import("./tv-devices-panel").then((m) => m.TvDevicesPanel), { ssr: false });
const TvSettingsDrawer = dynamic(() => import("./tv-settings").then((m) => m.TvSettingsDrawer), { ssr: false });

const DAYS_TR = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];
const MONTHS_TR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const pad = (n: number) => String(n).padStart(2, "0");
const ico = { width: "1em", height: "1em" } as const;
const TRANSITION_MS = 900;
const CELEBRATION_MS = 9000;
/** Son başarılı veri bundan eskiyse canlı rozet "Gecikmeli" der. */
const STALE_MS = 3 * 60_000;

const WEATHER_ICON: Record<WeatherKind, typeof Sun> = {
  clear: Sun,
  partly: CloudSun,
  cloudy: Cloud,
  fog: CloudFog,
  rain: CloudRain,
  snow: CloudSnow,
  storm: CloudLightning,
};

/** Hareketsizlik: `ms` boyunca fare/klavye/dokunma yoksa true (imleç + araç çubuğu gizlenir; işlevsel, süs değil). */
function useIdle(ms = 3000): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const arm = () => {
      setIdle(false);
      clearTimeout(t);
      t = setTimeout(() => setIdle(true), ms);
    };
    arm();
    const evs = ["mousemove", "pointerdown", "keydown", "touchstart"] as const;
    for (const e of evs) window.addEventListener(e, arm, { passive: true });
    return () => {
      clearTimeout(t);
      for (const e of evs) window.removeEventListener(e, arm);
    };
  }, [ms]);
  return idle;
}

/** Sahne içeriği var mı (boş sahne yayına girmez). */
function availability(d: TvData | null): Partial<Record<TvSceneId, boolean>> {
  if (!d) return { bugun: true };
  return {
    bugun: true,
    performans: true,
    lig: d.league.length > 0,
    ilanlar: d.listings.some((l) => l.coverSrc),
    hedefler: Boolean(d.goals.dealTarget) || d.goals.branches.length > 0 || d.league.some((r) => r.targetPct !== null),
    duyurular: d.announcements.length + d.wins.length + d.anniversaries.length + d.badges.length > 0,
    sistem: true,
  };
}

function renderScene(id: TvSceneId, p: SceneProps) {
  switch (id) {
    case "bugun":
      return <SceneToday {...p} />;
    case "performans":
      return <ScenePerformance {...p} />;
    case "lig":
      return <SceneLeague {...p} />;
    case "ilanlar":
      return <SceneListings {...p} />;
    case "hedefler":
      return <SceneGoals {...p} />;
    case "duyurular":
      return <SceneNews {...p} />;
    case "sistem":
      return <SceneSystem {...p} />;
  }
}

/**
 * Ofis Panosu (TV) v2 — sahne tabanlı duvar ekranı (docs/design/TV_MODU_v2.md).
 * `mode="device"` (OA6): oturumsuz, eşleşmiş ofis TV'si (/tv). Veri `/api/tv/data`'dan yoklamayla gelir (anon realtime
 * yok), tutarlar hiçbir koşulda açılmaz, ayar/çıkış bağlantısı yoktur; eşleşme iptal edilince ekran yeniden eşleştirmeye döner.
 */
export function TvBoard({ tenantId, officeName, mode = "session" }: { tenantId: string; officeName: string; mode?: "session" | "device" }) {
  const device = mode === "device";
  const source = device ? DEVICE_TV_SOURCE : SESSION_TV_SOURCE;
  const { data, status, updatedAt, reload } = useTvData(tenantId, source);
  const config = data?.config ?? DEFAULT_TV_CONFIG;
  const minuteNow = useClock(30_000);
  const reduced = useReducedMotion();
  const idle = useIdle(3000);

  const rootRef = useRef<HTMLDivElement>(null);
  const [fs, setFs] = useState(false);
  const exitedByUser = useRef(false);
  const [hintOn, setHintOn] = useState(true);
  const [manualPause, setManualPause] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [drawer, setDrawer] = useState<"settings" | "devices" | null>(null);
  const [celebration, setCelebration] = useState<TvData["wins"][number] | null>(null);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const prevIds = useRef<{ win: Set<string>; appt: Set<string>; ev: Set<string> } | null>(null);

  useWakeLock(true);
  useDailyReload(4);

  const hour = minuteNow ? trParts(minuteNow).hour : 12;
  const night = config.nightMode && isNightHour(hour) && idle;
  const avail = useMemo(() => availability(data), [data]);
  const plan = useMemo(() => planScenes(config, avail, hour), [config, avail, hour]);
  const paused = manualPause || (hovering && !idle) || celebration !== null || night || drawer !== null;
  const { index, current, cycle, next, prev } = useSceneRotation(plan, paused);

  // Geçiş: çıkan sahne TRANSITION_MS boyunca alt katmanda kalır (opacity + transform; yalnız kompozit).
  const [leaving, setLeaving] = useState<{ id: TvSceneId; key: number } | null>(null);
  const shown = useRef<{ id: TvSceneId; key: number } | null>(null);
  useEffect(() => {
    if (!current) return;
    const was = shown.current;
    shown.current = { id: current.id, key: cycle };
    if (!was || was.key === cycle || reduced) return;
    setLeaving(was);
    const t = setTimeout(() => setLeaving(null), TRANSITION_MS);
    return () => clearTimeout(t);
  }, [current, cycle, reduced]);

  useEffect(() => {
    const t = setTimeout(() => setHintOn(false), 7000);
    return () => clearTimeout(t);
  }, []);

  // Kabuğu örten katman: gövde kaydırması kapalı
  useEffect(() => {
    document.documentElement.classList.add("tv-active");
    return () => document.documentElement.classList.remove("tv-active");
  }, []);

  // Kiosk: uygulama kabuğu TV katmanının altında kalır; odak ve ekran okuyucu oraya gidemesin diye kardeşler `inert`.
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

  useEffect(() => {
    const onFs = () => {
      const on = Boolean(document.fullscreenElement);
      setFs((was) => {
        if (was && !on) exitedByUser.current = true;
        return on;
      });
    };
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

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
    if (!document.fullscreenElement && !exitedByUser.current && drawer === null) void toggleFullscreen();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(t.tagName) && e.key !== "Escape") return;
      if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") prev();
      else if (e.key === " " || e.key === "p" || e.key === "P") {
        e.preventDefault();
        setManualPause((x) => !x);
      } else if (e.key === "f" || e.key === "F") void toggleFullscreen();
      else if ((e.key === "s" || e.key === "S") && !device) setDrawer((d) => (d === "settings" ? null : "settings"));
      else if (e.key === "Escape") setDrawer(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev, toggleFullscreen, device]);

  // Yeni öğe vurgusu + "Satış kapandı" kutlaması (yalnız YENİ kimlikler; ilk yüklemede kutlama yok)
  useEffect(() => {
    if (!data) return;
    const ids = {
      win: new Set(data.wins.map((w) => w.id)),
      appt: new Set(data.today.appointments.map((a) => a.id)),
      ev: new Set(data.events.map((e) => e.id)),
    };
    const was = prevIds.current;
    prevIds.current = ids;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const wonNow = newIds(was?.win ?? null, [...ids.win]);
    const firstWin = data.wins.find((w) => wonNow.has(w.id));
    if (firstWin) {
      setCelebration(firstWin);
      timers.push(setTimeout(() => setCelebration(null), CELEBRATION_MS));
    }
    const added = new Set([...newIds(was?.appt ?? null, [...ids.appt]), ...newIds(was?.ev ?? null, [...ids.ev])]);
    if (added.size) {
      setFresh(added);
      timers.push(setTimeout(() => setFresh(new Set()), 8000));
      const ev = data.events.find((e) => added.has(e.id));
      if (ev && !firstWin) {
        setToast(ev.label);
        timers.push(setTimeout(() => setToast(null), 6000));
      }
    }
    return () => timers.forEach(clearTimeout);
  }, [data]);

  const shift = burnInOffset(minuteNow ? Math.floor(minuteNow / 60_000) : 0);
  const stale = status === "ok" && updatedAt > 0 && minuteNow - updatedAt > STALE_MS;
  const name = data?.office.name ?? officeName;
  const nextScene = plan.length > 1 ? plan[stepIndex(index, plan.length, 1)] : null;

  // Zemin fotoğrafı: kapaklı portföylerden sahneye göre döner (ilan sahnesi zaten tam ekran fotoğraftır).
  const covers = useMemo(() => (data?.listings ?? []).map((l) => l.coverSrc).filter((s): s is string => Boolean(s)), [data]);
  const backdropFor = (key: number) => (covers.length ? covers[key % covers.length] : null);

  const sceneProps = (sceneMs: number): SceneProps | null =>
    data
      ? {
          data,
          nowMs: minuteNow,
          sceneMs,
          paused,
          fresh,
          device,
          live: source.realtime ? "realtime" : "poll",
          updatedAt,
        }
      : null;
  const curProps = current ? sceneProps(current.ms) : null;
  const leaveProps = leaving ? sceneProps(0) : null;

  return (
    <div
      ref={rootRef}
      className="tv-root"
      data-tv-root
      data-theme-tv={config.theme}
      data-tv-idle={idle}
      data-night={night}
      onClick={onRootClick}
      style={{ "--shift-x": reduced ? "0px" : `${shift.x}px`, "--shift-y": reduced ? "0px" : `${shift.y}px` } as CSSProperties}
    >
      <div className="tv-shift">
        <TvHeader data={data} name={name} plan={plan.map((p) => p.id)} index={index} status={status} stale={stale} updatedAt={updatedAt} />

        <main
          className="tv-stage"
          onPointerEnter={() => setHovering(true)}
          onPointerLeave={() => setHovering(false)}
          aria-live="off"
          aria-label={current ? TV_SCENE_META[current.id].label : "Pano"}
        >
          {leaving && leaveProps ? (
            <div className="tv-scene" data-state="leave" key={`l-${leaving.key}`} aria-hidden>
              {leaving.id === "ilanlar" ? null : <SceneBackdrop src={backdropFor(leaving.key)} />}
              {renderScene(leaving.id, leaveProps)}
            </div>
          ) : null}
          {current && curProps ? (
            <div className="tv-scene" data-state="enter" data-scene={current.id} key={`s-${cycle}`}>
              {current.id === "ilanlar" ? null : <SceneBackdrop src={backdropFor(cycle)} />}
              {renderScene(current.id, curProps)}
            </div>
          ) : null}
        </main>

        <footer className="tv-foot">
          <div className="tv-progress" aria-hidden>
            {current && plan.length > 1 ? (
              <i key={`p-${cycle}`} style={{ animationDuration: `${current.ms}ms`, animationPlayState: paused ? "paused" : "running" }} />
            ) : null}
          </div>
          <div className="tv-foot-row">
            <span className="tv-foot-now">
              {current ? TV_SCENE_META[current.id].label : ""}
              {paused && !night ? <em> · duraklatıldı</em> : null}
            </span>
            {data?.sampleLabel ? <span className="tv-tag">{data.sampleLabel}</span> : null}
            <span className="tv-foot-spacer" />
            {nextScene ? (
              <span className="tv-foot-next">
                Sıradaki: <b>{TV_SCENE_META[nextScene.id].label}</b>
              </span>
            ) : null}
          </div>
        </footer>
      </div>

      {night ? <NightScreen name={name} logoUrl={data?.office.logoUrl ?? null} /> : null}

      {!data && status === "loading" ? (
        <div className="tv-overlay" role="status">
          <span className="tv-loader" aria-hidden />
          <h2>Pano hazırlanıyor…</h2>
        </div>
      ) : null}

      {celebration && data ? <CelebrationOverlay win={celebration} monthDeals={data.goals.deals} reduced={reduced} /> : null}

      {toast && !celebration ? (
        <div className="tv-toast" role="status" aria-live="polite" key={toast}>
          <Sparkles style={ico} aria-hidden /> {toast}
        </div>
      ) : null}

      {device && status === "session" ? (
        <div className="tv-overlay" role="alert">
          <h2>Bu ekranın eşleşmesi kaldırıldı</h2>
          <p>Panoyu yeniden yayınlamak için ekranı yeniden eşleştirin.</p>
          {/* Tam sayfa yükleme bilinçli: /tv eşleştirme ekranı çerezi sunucuda yeniden okur. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a className="tv-btn" data-primary="true" href="/tv">
            Yeniden eşleştir
          </a>
        </div>
      ) : null}

      {!device && status === "session" ? (
        <div className={data ? "tv-session" : "tv-overlay"} role="alert">
          <span>{data ? "Oturum süresi doldu; pano son verileri gösteriyor." : "Oturum süresi doldu. Panoyu sürdürmek için yeniden giriş yapın."}</span>
          {/* Oturum bittiği için tam sayfa yenileme isteniyor; Link ile istemci geçişi oturumu tazelemez. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a className="tv-btn" data-primary="true" href="/giris?next=/app/pano-tv">
            Yeniden giriş yap
          </a>
        </div>
      ) : null}

      {status === "forbidden" ? (
        <div className="tv-overlay" role="alert">
          <h2>Bu pano yalnız ofis geneli kapsamdaki rollere açık</h2>
          <p>Ofis sahibi, genel müdür veya şube müdürü hesabıyla açın.</p>
          <Link className="tv-btn" href="/app">
            Panele dön
          </Link>
        </div>
      ) : null}

      {!fs && hintOn ? (
        <div className="tv-hint" aria-hidden>
          <Maximize2 style={ico} /> Tam ekran için ekrana tıklayın veya F · Sahneler ← → · Duraklat: boşluk
        </div>
      ) : null}

      <div className="tv-tools" role="toolbar" aria-label="TV araçları" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="tv-icon-btn" onClick={prev} title="Önceki sahne (←)" aria-label="Önceki sahne">
          <ChevronLeft style={ico} />
        </button>
        <button type="button" className="tv-icon-btn" onClick={() => setManualPause((p) => !p)} aria-pressed={manualPause} title="Duraklat (boşluk)" aria-label={manualPause ? "Devam" : "Duraklat"}>
          {manualPause ? <Play style={ico} /> : <Pause style={ico} />}
        </button>
        <button type="button" className="tv-icon-btn" onClick={next} title="Sonraki sahne (→)" aria-label="Sonraki sahne">
          <ChevronRight style={ico} />
        </button>
        <span className="tv-tools-sep" aria-hidden />
        <button type="button" className="tv-btn" onClick={() => void toggleFullscreen()} aria-pressed={fs} title="Tam ekran (F)">
          {fs ? <Minimize2 style={ico} aria-hidden /> : <Maximize2 style={ico} aria-hidden />}
          {fs ? "Tam ekrandan çık" : "Tam ekran"}
        </button>
        {!device ? (
          <>
            <button type="button" className="tv-btn" onClick={() => setDrawer((d) => (d === "settings" ? null : "settings"))} aria-expanded={drawer === "settings"} title="TV ayarları (S)">
              <Settings2 style={ico} aria-hidden /> Ayarlar
            </button>
            <button type="button" className="tv-btn" onClick={() => setDrawer((d) => (d === "devices" ? null : "devices"))} aria-expanded={drawer === "devices"} title="Ofis TV'lerini eşleştir">
              <MonitorSmartphone style={ico} aria-hidden /> TV ekranları
            </button>
            <Link href="/app" className="tv-btn" title="TV modundan çık">
              <LogOut style={ico} aria-hidden /> Çıkış
            </Link>
          </>
        ) : null}
      </div>

      {drawer === "devices" && !device ? <TvDevicesPanel onClose={() => setDrawer(null)} /> : null}
      {drawer === "settings" && !device ? (
        <TvSettingsDrawer config={config} moneyPossible={data?.moneyPossible ?? false} onClose={() => setDrawer(null)} onSaved={() => void reload()} />
      ) : null}
    </div>
  );
}

/* ------------------------------ Üst şerit ------------------------------ */

export function TvHeader({
  data,
  name,
  plan,
  index,
  status,
  stale,
  updatedAt,
}: {
  data: TvData | null;
  name: string;
  plan: TvSceneId[];
  index: number;
  status: string;
  stale: boolean;
  updatedAt: number;
}) {
  const clock = useClock(1000);
  const c = clock ? trParts(clock) : null;
  const w = data?.weather ?? null;
  const WIcon = w ? WEATHER_ICON[w.kind] : null;
  const offline = status === "offline" || status === "session";
  const upd = updatedAt ? trParts(updatedAt) : null;
  return (
    <header className="tv-head">
      <div className="tv-brand">
        {data?.office.logoUrl ? <img src={data.office.logoUrl} alt="" className="tv-logo" /> : <Brand variant="mark" tone="dark" height={56} alt="" />}
        <div className="tv-brand-text">
          <span className="tv-office">{name}</span>
          <span className="tv-office-sub">
            Canlı Ofis Panosu{data?.office.city ? ` · ${data.office.city}` : ""}
          </span>
        </div>
      </div>

      <nav className="tv-scenes-nav" aria-label="Sahneler">
        {plan.map((id, i) => (
          <span key={id} className="tv-scene-chip" data-on={i === index} aria-current={i === index ? "step" : undefined}>
            {TV_SCENE_META[id].short}
          </span>
        ))}
        <span className="tv-scene-count">
          {plan.length ? index + 1 : 0}/{plan.length}
        </span>
      </nav>

      <div className="tv-head-right">
        {w && WIcon ? (
          <span className="tv-weather" title={w.label}>
            <WIcon style={ico} aria-hidden />
            <b>{w.tempC}°</b>
            <small>{w.label}</small>
          </span>
        ) : null}
        <span className="tv-live" data-state={offline ? "offline" : stale ? "stale" : "live"} role="status">
          {offline ? (
            <>
              <WifiOff style={ico} aria-hidden /> Bağlantı yok
            </>
          ) : (
            <>
              <i className="tv-dot" aria-hidden /> {stale ? "Gecikmeli" : "Canlı"}
              {upd ? <small>{`${pad(upd.hour)}:${pad(upd.minute)}`}</small> : null}
            </>
          )}
        </span>
        <div className="tv-time">
          <span className="tv-clock" suppressHydrationWarning>
            {c ? `${pad(c.hour)}:${pad(c.minute)}` : "--:--"}
          </span>
          <span className="tv-date" suppressHydrationWarning>
            {c ? `${c.day} ${MONTHS_TR[c.month]} ${c.year}, ${DAYS_TR[c.weekday]}` : ""}
          </span>
        </div>
      </div>
    </header>
  );
}

/* ------------------------------ Gece modu ------------------------------ */

function NightScreen({ name, logoUrl }: { name: string; logoUrl: string | null }) {
  const clock = useClock(1000);
  const c = clock ? trParts(clock) : null;
  // Gece ekranı da burn-in'e karşı yavaşça yer değiştirir (dakikada bir).
  const minute = clock ? Math.floor(clock / 60_000) : 0;
  const pos = { x: ((minute * 37) % 40) - 20, y: ((minute * 23) % 30) - 15 };
  return (
    <div className="tv-night" role="status" aria-label="Gece modu">
      <div className="tv-night-inner" style={{ transform: `translate(${pos.x}vw, ${pos.y}vh)` }}>
        {logoUrl ? <img src={logoUrl} alt="" className="tv-logo" /> : <Brand variant="mark" tone="dark" height={48} alt="" />}
        <span className="tv-night-clock" suppressHydrationWarning>
          {c ? `${pad(c.hour)}:${pad(c.minute)}` : "--:--"}
        </span>
        <span className="tv-night-date" suppressHydrationWarning>
          {c ? `${c.day} ${MONTHS_TR[c.month]}, ${DAYS_TR[c.weekday]}` : ""} · {name}
        </span>
      </div>
    </div>
  );
}
