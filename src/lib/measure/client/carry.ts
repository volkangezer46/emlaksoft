/**
 * Atıf taşıma (TARAYICI; yalnız `measure.attribution` açıkken kurulur — kapalıyken bu modül hiçbir şey yazmaz).
 *
 * Oturumun girişindeki kaynak (UTM etiketleri, yönlendiren ANA MAKİNE, iniş yolu) sekmeye özel `sessionStorage`'da
 * 30 dk (her sayfa yüklemesinde uzar) tutulur; tıklama anında `/kayit` bağlantısına `lp`, `src_host`, `utm_*` eklenir.
 * Çerez YOK, kalıcı depolama YOK, tıklama kimliği okunmaz. Her depolama erişimi try/catch içindedir (gizli sekme,
 * engellenmiş site verisi): hata olursa taşıma sessizce atlanır, sayfa etkilenmez.
 * Girdiler enjekte edilir (test: sahte depolama/belge ile). Paket bütçesi (≤3 KB gzip, web-vitals dahil) için kısa yazılır.
 */
export type CarryStorage = { getItem(k: string): string | null; setItem(k: string, v: string): void };
export type CarryLocation = { pathname: string; search: string; host: string; origin: string };

/** UTM kısa anahtarları → sorgu adı. */
export const UTM = { s: "utm_source", m: "utm_medium", c: "utm_campaign", t: "utm_term", o: "utm_content" } as const;
export type Utm = Partial<Record<keyof typeof UTM, string>>;
/** Taşınan dokunuş: lp iniş yolu, h yönlendiren ana makine ("" = yok), u UTM, x son geçerlilik. */
export type Touch = { lp: string; h: string; u: Utm; x: number };

export const CARRY_KEY = "es_m";
export const CARRY_TTL_MS = 30 * 60_000;

/** Sorgudaki UTM etiketleri (≤64 karakter). */
export function utmOf(search: string): Utm {
  const q = new URLSearchParams(search);
  const out: Utm = {};
  for (const k in UTM) {
    const v = q.get(UTM[k as keyof typeof UTM]);
    if (v) out[k as keyof typeof UTM] = v.slice(0, 64);
  }
  return out;
}

/**
 * Bu yüklemeyi değerlendirir: yeni giriş (UTM var, dış yönlendiren var ya da geçerli kayıt yok) ise dokunuş yenilenir,
 * değilse mevcut dokunuşun süresi uzatılır. `refHost` dış yönlendirenin ana makinesi ("" = yok ya da kendi sitemiz).
 */
export function captureTouch(storage: CarryStorage | null, loc: CarryLocation, refHost: string, nowMs: number): Touch {
  let t: Touch | null = null;
  try {
    t = JSON.parse(storage?.getItem(CARRY_KEY) || "null") as Touch | null;
  } catch {
    /* bozuk kayıt: yeni giriş sayılır */
  }
  const u = utmOf(loc.search);
  const ext = refHost && refHost !== loc.host ? refHost : "";
  if (!t || !(t.x > nowMs) || typeof t.lp !== "string" || ext || Object.keys(u).length) t = { lp: loc.pathname, h: ext, u, x: 0 };
  t.x = nowMs + CARRY_TTL_MS;
  try {
    storage?.setItem(CARRY_KEY, JSON.stringify(t));
  } catch {
    /* depolama yok/dolu: yalnız bu sayfada taşınır */
  }
  return t;
}

/** `/kayit` bağlantısıysa (aynı köken) atıf parametreleri eklenmiş adres; değilse null. Var olan parametre ezilmez. */
export function decorateHref(href: string, origin: string, t: Touch): string | null {
  let url: URL;
  try {
    url = new URL(href, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin || url.pathname !== "/kayit") return null;
  const p = url.searchParams;
  const add = (k: string, v?: string) => v && !p.has(k) && p.set(k, v);
  add("lp", t.lp);
  add("src_host", t.h);
  for (const k in t.u) add(UTM[k as keyof typeof UTM], t.u[k as keyof typeof UTM]);
  return url.pathname + url.search + url.hash;
}

type Anchor = { getAttribute(n: string): string | null; setAttribute(n: string, v: string): void };
type ClickDoc = { addEventListener(type: "click", fn: (e: { target: unknown }) => void, capture: boolean): void };

/** Atıf taşımayı kurar. `enabled` false ise HİÇBİR şey yapmaz (depolama okunmaz/yazılmaz, bağlantı değişmez). */
export function installCarry(
  enabled: boolean,
  env: { storage: () => CarryStorage | null; loc: CarryLocation; refHost: string; doc: ClickDoc; now: number },
): void {
  if (!enabled) return;
  let storage: CarryStorage | null = null;
  try {
    storage = env.storage();
  } catch {
    /* depolama erişimi engelli */
  }
  const t = captureTouch(storage, env.loc, env.refHost, env.now);
  env.doc.addEventListener(
    "click",
    (e) => {
      const a = (e.target as { closest?: (s: string) => Anchor | null }).closest?.("a[href]");
      const next = a && decorateHref(a.getAttribute("href")!, env.loc.origin, t);
      if (next) a.setAttribute("href", next);
    },
    true,
  );
}
