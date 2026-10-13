import { describe, expect, it } from "vitest";
import {
  NEVER_STATIC_PREFIXES,
  STATIC_ISLAND_ENTRIES,
  STATIC_ROUTES,
  isStaticEligiblePath,
  matchStaticIds,
  staticRouteById,
  staticRouteByPath,
} from "./registry";
import { staticRewriteTarget } from "./request";
import { enabledStaticIds, envDisables, parseStaticRoutes, staticRouteMode } from "./settings";

const LEGAL = ["gizlilik", "kvkk-aydinlatma", "kullanim-sartlari", "cerez-politikasi", "mesafeli-satis", "on-bilgilendirme", "iptal-iade", "davet-kosullari"];
const PROD = { NODE_ENV: "production" };
const headers = (h: Record<string, string> = {}) => ({ get: (n: string) => h[n.toLowerCase()] ?? null });
const req = (pathname: string) => ({ method: "GET", pathname, searchParams: { has: () => false }, headers: headers(), env: PROD });

describe("statik kayıt defteri", () => {
  it("ana sayfa varsayılan açık; 8 yasal sayfa varsayılan KAPALI; /fiyatlar listede ama kalıcı kapalı", () => {
    expect(staticRouteById("home")).toMatchObject({ path: "/", defaultEnabled: true });
    for (const id of LEGAL) expect(staticRouteById(id), id).toMatchObject({ path: `/${id}`, defaultEnabled: false });
    expect(STATIC_ROUTES.filter((r) => LEGAL.includes(r.id))).toHaveLength(8);
    const pricing = staticRouteById("fiyatlar");
    expect(pricing?.disabled).toBeTruthy();
    expect(staticRouteMode(pricing!, { fiyatlar: true }, PROD)).toBe("disabled");
  });

  it("kimlik ve yol birebir eşleşir (prototip anahtarları, sondaki / ve sorgu reddedilir)", () => {
    expect(staticRouteById("constructor")).toBeNull();
    expect(staticRouteById("__proto__")).toBeNull();
    expect(staticRouteByPath("/gizlilik/")).toBeNull();
    expect(staticRouteByPath("/gizlilik?x=1")).toBeNull();
    expect(new Set(STATIC_ROUTES.map((r) => r.id)).size).toBe(STATIC_ROUTES.length);
    expect(new Set(STATIC_ROUTES.map((r) => r.path)).size).toBe(STATIC_ROUTES.length);
  });

  it("S8 ön sürümü: kayıttaki her yol herkese açık ve otomatik iyileştirmeye uygun", () => {
    for (const r of STATIC_ROUTES) expect(isStaticEligiblePath(r.path), r.path).toBe(true);
  });

  it("üyelik/oturum yolları uygun değil ve kayıtta yok", () => {
    for (const p of ["/app", "/app/musteriler", "/admin", "/giris", "/giris/mfa", "/kayit", "/kayit/tamamla", "/sifre-yenile", "/auth/callback", "/malik-portali/x", "/musteri-portali/x"]) {
      expect(isStaticEligiblePath(p), p).toBe(false);
      expect(staticRouteByPath(p), p).toBeNull();
    }
    for (const p of NEVER_STATIC_PREFIXES) expect(STATIC_ROUTES.some((r) => r.path === p || r.path.startsWith(`${p}/`)), p).toBe(false);
  });

  it("adacıklar derleme girişlerinde tanımlı", () => {
    for (const r of STATIC_ROUTES) for (const i of r.islands) expect(STATIC_ISLAND_ENTRIES[i], `${r.id}:${i}`).toBeTruthy();
  });

  it("livePaths eşlemesi: yol normalleştirilir, * tümünü kapsar", () => {
    expect(matchStaticIds(["/gizlilik/", "/fiyatlar?x=1", "/yok"])).toEqual(["gizlilik", "fiyatlar"]);
    expect(matchStaticIds(["/"])).toEqual(["home"]);
    expect(matchStaticIds(["*"])).toHaveLength(STATIC_ROUTES.length);
    expect(matchStaticIds([])).toEqual([]);
  });
});

describe("staticRewriteTarget — oturum yolları her zaman null", () => {
  const all = new Set<string>(STATIC_ROUTES.map((r) => r.id));
  it.each(["/kayit", "/giris", "/app", "/admin", "/app/ayarlar", "/admin/site/hiz", "/giris/mfa", "/kayit/tamamla"])("%s", (p) => {
    expect(staticRewriteTarget(req(p), all)).toBeNull();
  });
  it("kalıcı kapalı kayıt (fiyatlar) açık kümede olsa bile yeniden yazılmaz", () => {
    expect(staticRewriteTarget(req("/fiyatlar"), all)).toBeNull();
  });
});

describe("statik anahtarlar ve env üstünlüğü", () => {
  it("ayar yoksa varsayılanlar: yalnız ana sayfa açık", () => {
    expect([...enabledStaticIds(null, PROD)]).toEqual(["home"]);
    expect([...enabledStaticIds("bozuk json", PROD)]).toEqual(["home"]);
  });

  it("DB anahtarı yasal sayfayı açar, ana sayfayı kapatabilir; bilinmeyen anahtar yok sayılır", () => {
    const ids = enabledStaticIds(JSON.stringify({ home: false, gizlilik: true, kotu: true, kvkk: "evet" }), PROD);
    expect([...ids]).toEqual(["gizlilik"]);
    expect(parseStaticRoutes('{"gizlilik":true,"fiyatlar":true}')).toEqual({ gizlilik: true, fiyatlar: true });
  });

  it("STATIC_HOME=off DB ayarını ezer (tümü kapalı)", () => {
    const raw = JSON.stringify({ home: true, gizlilik: true });
    const env = { NODE_ENV: "production", STATIC_HOME: "off" };
    expect(enabledStaticIds(raw, env).size).toBe(0);
    expect(staticRouteMode(staticRouteById("home")!, { home: true }, env)).toBe("env_off");
    expect(staticRewriteTarget({ ...req("/"), env }, new Set(["home"]))).toBeNull();
  });

  it("STATIC_PAGES=off yalnız ana sayfa dışını kapatır", () => {
    const env = { NODE_ENV: "production", STATIC_PAGES: "OFF" };
    expect([...enabledStaticIds(JSON.stringify({ gizlilik: true }), env)]).toEqual(["home"]);
    expect(envDisables(staticRouteById("gizlilik")!, env)).toBe(true);
    expect(envDisables(staticRouteById("home")!, env)).toBe(false);
  });
});
