import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXTENSION_VERSION, EXTENSION_DOWNLOAD_PATH } from "./extension-release";
import { EXTENSION_LIMITS } from "./extension-pacing";
import { PARSER_VERSION, PORTAL_RULES_VERSION } from "../adapters/html";

/**
 * İLAN KONTROL EKLENTİSİ SÖZLEŞMELERİ (kaynak düzeyi). Değişmez ilkeler: kullanıcının kendi tarayıcısı/oturumu, düşük hız,
 * CAPTCHA/giriş/hız sınırında durma, "engel = ilan yok" DEĞİL, sunucu portala bağlanmaz, en az izin, en az kişisel veri,
 * kullanıcı "Bağlan" demeden hiçbir kontrol yok. Bu testler kodu bu ilkelere bağlar; gevşetmek için kodu değil ilkeyi tartışın.
 */

const ROOT = process.cwd();
const EXT = "extensions/emlaksoft-ilan-kontrol";
const src = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("manifest ve paketleme (mağazaya hazırlık)", () => {
  const m = JSON.parse(src(`${EXT}/manifest.base.json`)) as Record<string, unknown>;
  it("MV3, en az izin: yalnız storage + alarms; gereksiz izin/erişim yok", () => {
    expect(m.manifest_version).toBe(3);
    expect(m.permissions).toEqual(["storage", "alarms"]);
    expect(m.externally_connectable).toBeUndefined(); // taban manifest'te yok; derleme betiği YALNIZ EmlakSoft kökenleri için yazar (aşağıdaki test)
    expect(m.web_accessible_resources).toBeUndefined();
    expect(m.optional_permissions).toBeUndefined();
    expect(JSON.stringify(m)).not.toMatch(/<all_urls>|"tabs"|"cookies"|"webRequest"|"scripting"|"activeTab"|"declarativeNetRequest"/);
    expect(m.host_permissions).toEqual([]); // derleme betiği yalnız portal adaptör alanlarını yazar
  });
  it("sürüm tek kaynak; ikonlar 16/32/48/128 var ve manifest'e bağlı", () => {
    expect(m.version).toBe(EXTENSION_VERSION);
    const icons = m.icons as Record<string, string>;
    for (const size of ["16", "32", "48", "128"]) {
      expect(icons[size]).toBe(`icons/icon-${size}.png`);
      expect(existsSync(join(ROOT, EXT, "icons", `icon-${size}.png`)), size).toBe(true);
    }
    expect((m.action as { default_icon: Record<string, string> }).default_icon["128"]).toBe("icons/icon-128.png");
  });
  it("build:extension ZIP üretir (sürüm numaralı); prebuild yumuşak, uygulama derlemesini engellemez", () => {
    const b = src("scripts/build-extension.ts");
    expect(b).toContain("createZip(");
    expect(b).toContain("extensionZipFileName()");
    expect(b).toContain("__EMLAKSOFT_APP_ORIGINS__");
    expect(b).toMatch(/--soft/);
    const pkg = src("package.json");
    expect(pkg).toContain('"prebuild": "tsx scripts/build-extension.ts --soft"');
    expect(pkg).toContain('"build:extension"');
    expect(src(".gitignore")).toContain("/public/downloads/");
    expect(src(`${EXT}/.gitignore`)).toMatch(/^release\/$/m);
  });
});

describe("ilkeler: kaynak kodu kilidi", () => {
  const bg = src(`${EXT}/src/background.ts`);
  const content = src(`${EXT}/src/content.ts`);
  const popup = src(`${EXT}/src/popup.ts`);
  it("hız/engel: her portal isteği pacingDecision + engel beklemesinden geçer; bağlı değilken ve çalışma saati dışında istek yok", () => {
    expect(bg).toContain("pacingDecision(");
    expect(bg).toContain("applyBlockCooldown(");
    expect(bg).toContain("withinWorkingHours(");
    expect(bg.indexOf("isConnected()")).toBeGreaterThan(-1);
    // paced(): ilk iş bağlantı denetimi, sonra duraklatma, sonra çalışma saati, sonra hız kuralı.
    const paced = bg.slice(bg.indexOf("async function paced"), bg.indexOf("async function recordOutcome"));
    const order = ["isConnected()", "isPaused()", "withinWorkingHours(", "pacingDecision("].map((s) => paced.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(bg.match(/\bfetch\(/g)?.length).toBe(1); // tek geçit: yalnız fetchPage
  });
  it("ayar hızı gevşetemez: günlük sınır tavanı aşılamaz, saatlik/aralık değerleri sabit", () => {
    expect(EXTENSION_LIMITS).toMatchObject({ minIntervalMs: 20_000, maxPerHour: 60, maxPerDay: 600, blockCooldownMs: 30 * 60_000 });
    expect(src("src/lib/listing-control/worker/extension-pacing.ts")).toContain("Math.min(EXTENSION_LIMITS.maxPerDay");
  });
  it("yasak teknikler yok: UA taklidi, CAPTCHA çözme, proxy, sekme/pencere açma, eval, dış istek", () => {
    for (const s of [bg, content, popup]) {
      expect(s).not.toMatch(/user-agent|User-Agent|captcha.?solv|2captcha|anticaptcha|proxy|\beval\(|new Function\(|innerHTML|document\.write/i);
    }
    for (const s of [bg, content]) expect(s).not.toMatch(/chrome\.windows|chrome\.cookies/);
    // Portal sayfası sekmesi AÇILMAZ. Tek istisna (0.3.1): ilk kurulumda EmlakSoft'un kendi karşılama sayfası (onInstalled, install landing).
    expect(content).not.toMatch(/chrome\.tabs/);
    expect(bg.replace("chrome.tabs.create({ url: landing })", "")).not.toMatch(/chrome\.tabs/);
    expect(popup).not.toMatch(/https?:\/\/(?!\$\{)/); // popup'ta sabit dış adres yok
  });
  it("sunucu portala bağlanmaz; kişisel veri en az: telemetri yalnız sayaç", () => {
    for (const f of ["src/app/api/app/ilan-kontrol/isci/route.ts", "src/lib/listing-control/worker/extension-telemetry.ts"]) {
      expect(src(f), f).not.toMatch(/sahibinden\.com|hepsiemlak\.com|emlakjet\.com/);
    }
    const t = src("src/lib/listing-control/worker/extension-telemetry.ts");
    const shape = t.slice(t.indexOf("export type ParserTelemetry"), t.indexOf("const VERSION_RE"));
    expect(shape).not.toMatch(/title|price|externalId|advisor|listingNo/i);
  });
  it("tek tuş: bağlanmadan kontrol yok; bağlan isteği köken + kullanıcı etkinliği doğrular; kimlik/oturum anahtarı eklentiye geçmez", () => {
    expect(content).toContain("isTrustedConnectRequest(");
    expect(content).toContain("userActivation");
    expect(content).toContain("if (paused || !connected) return \"idle\"");
    expect(content).toContain("window.location.origin"); // postMessage hedef kökeni sabit
    expect(content).not.toMatch(/postMessage\([^)]*"\*"/);
    expect(bg).toContain("isTrustedSender(");
    expect(`${bg}${content}${popup}`).not.toMatch(/access_token|refresh_token|Authorization|Bearer|sb-.*-auth-token/);
  });
  it("güvenilirlik: alarm ile uyandırma, sonuç kuyruğu (idempotent iş kimliği), üstel geri çekilme, tek sekme kilidi", () => {
    expect(bg).toContain("chrome.alarms.create(");
    expect(bg).toContain("chrome.alarms.onAlarm");
    expect(content).toContain("flushOutbox");
    expect(content).toContain("outboxPut");
    expect(content).toContain("nextDelayMs(outcome, errors");
    expect(bg).toContain("leaseDecision(");
  });
  it("ayrıştırıcı sürümü her sonuçla gider: motor@kural; sunucu yalnız applied sonuçta sayar", () => {
    expect(PARSER_VERSION).toBe(`e2@${PORTAL_RULES_VERSION}`);
    expect(content).toContain("buildTelemetry(");
    const route = src("src/app/api/app/ilan-kontrol/isci/route.ts");
    expect(route).toContain('done.outcome === "applied"');
    expect(route).toContain("workerReportParser(");
    expect(src("src/app/actions/listing-control-worker.ts")).toContain('rpc("lc_parser_report"');
  });
});

describe("günlük tarama ve siteden algılama (0.3.0)", () => {
  const bg = src(`${EXT}/src/background.ts`);
  const content = src(`${EXT}/src/content.ts`);
  it("externally_connectable yalnız EmlakSoft kökenleri; dış kanalda yalnız salt-okunur ping", () => {
    const b = src("scripts/build-extension.ts");
    expect(b).toContain("manifest.externally_connectable = { matches: origins.map((o) => `${o}/*`) }");
    const ext = bg.slice(bg.indexOf("onMessageExternal.addListener"));
    expect(ext).toContain("isAllowedAppOrigin(sender.origin");
    expect(ext).toContain('m.kind !== "ping"');
    expect(ext).not.toMatch(/setConnected|saveSettings|probe|inventory|scanNow|outbox/);
  });
  it("tarama: alarm saatte bir, süren tarama sürdürülür, hız kuralı paced() içinden, yükleme yalnız EmlakSoft sekmesinden", () => {
    expect(bg).toContain("ALARM_SCAN");
    expect(bg).toContain("periodInMinutes: 60");
    expect(bg).toContain("runScanCycle(");
    expect(bg).toContain("applyPage(");
    expect(bg).toContain("getPlatformInfo");
    expect(content).toContain("flushScans");
    expect(content).toContain("BRIDGE_INVENTORY_ENDPOINT");
    expect(bg.match(/\bfetch\(/g)?.length).toBe(1); // tarama da tek geçitten (fetchPage) gider
  });
  it("yükleme ucu: aynı köken + oturum + portals/edit; tamlık sunucuda yeniden hesaplanır; sunucu portala bağlanmaz", () => {
    const route = src("src/app/api/app/ilan-kontrol/envanter/route.ts");
    expect(route).toContain("isSameOriginBridgeRequest(");
    expect(route).toContain("sanitizeUpload(");
    expect(route).not.toMatch(/sahibinden\.com|hepsiemlak\.com|emlakjet\.com/);
    expect(src("src/app/actions/listing-control-inventory.ts")).toContain('requirePermission("portals", "edit")');
  });
});

describe("uygulama içi sayfa /app/ilan-kontrol/eklenti", () => {
  const page = src("src/app/app/ilan-kontrol/eklenti/page.tsx");
  const wizard = src("src/components/listing-control/extension-wizard.tsx");
  it("son kullanıcı ekranında teknik komut/depo yolu yok; geliştirici notu docs'ta", () => {
    for (const s of [page, wizard]) {
      expect(s).not.toMatch(/npm run|extensions\/emlaksoft|tsx scripts|dist klasör/i);
    }
    expect(existsSync(join(ROOT, "docs/runbooks/ILAN_KONTROL_EKLENTI_YAYIN.md"))).toBe(true);
    expect(src("docs/runbooks/ILAN_KONTROL_EKLENTI_YAYIN.md")).toContain("npm run build:extension");
  });
  it("3 adımlı sihirbaz: indir → yükle → bağla; otomatik algılama; tek tık bağla", () => {
    expect(wizard).toContain("wizardView(");
    expect(wizard).toContain("bridgeInstalled()");
    expect(wizard).toContain("bridgeConnected()");
    expect(wizard).toContain("requestConnect()");
    expect(wizard).toMatch(/Eklentiyi bağla/);
    expect(wizard).toMatch(/Eklentiyi indir \(ZIP/);
    expect(wizard).toMatch(/Chrome&apos;a ekle/);
    expect(page).toContain("requireModulePage(\"portals\"");
    expect(page).toContain("extensionStoreEnv()");
    expect(src("src/lib/listing-control/worker/extension-release.ts")).toContain("NEXT_PUBLIC_LISTING_EXTENSION_CWS_URL");
    expect(page).toContain("EXTENSION_DOWNLOAD_PATH");
  });
  it("indirme ucu: oturum + portals/view; paket yoksa 404; izleme dosyaları yapılandırılmış", () => {
    expect(EXTENSION_DOWNLOAD_PATH).toBe("/api/app/ilan-kontrol/eklenti.zip");
    const route = src("src/app/api/app/ilan-kontrol/eklenti.zip/route.ts");
    expect(route).toContain('requirePermission("portals", "view")');
    expect(route).toContain("status: 404");
    expect(route).toContain("application/zip");
    expect(src("next.config.ts")).toContain("/api/app/ilan-kontrol/eklenti.zip");
    expect(src(".env.example")).toContain("NEXT_PUBLIC_LISTING_EXTENSION_CWS_URL");
    expect(src(".env.example")).toContain("NEXT_PUBLIC_LISTING_EXTENSION_EDGE_URL");
  });
});

describe("migration (telemetri) ve yayın belgesi", () => {
  it("tablo RLS'li, dar yetkili; yazma yalnız JWT RPC; kişisel veri alanı yok; rollback var", () => {
    const sql = src("supabase/migrations/20261008000400_lc_parser_telemetry.sql");
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("revoke all on table public.lc_parser_telemetry from public, anon, authenticated");
    expect(sql).toContain("grant select on table public.lc_parser_telemetry to authenticated");
    expect(sql).not.toMatch(/grant (insert|update|delete|all)[^;]*to authenticated/i);
    expect(sql).toContain("has_effective_permission('portals', 'edit')");
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = ''");
    expect(sql).not.toMatch(/external_id|title|price|advisor/i);
    expect(existsSync(join(ROOT, "supabase/rollbacks/20261008000400_lc_parser_telemetry.rollback.sql"))).toBe(true);
    expect(src("scripts/migration-pairs-data.ts")).toContain("20261008000400_lc_parser_telemetry.sql");
  });
  it("yayın runbook'u: mağaza adımları, gizlilik metni, ekran görüntüsü listesi, sürüm yükseltme", () => {
    const doc = src("docs/runbooks/ILAN_KONTROL_EKLENTI_YAYIN.md");
    for (const h of ["Chrome Web Store", "Edge Add-ons", "Gizlilik politikası", "Ekran görüntüsü", "Sürüm yükseltme", "İzin gerekçeleri", "Gerçek portal sayfasına karşı doğrulama"]) {
      expect(doc, h).toContain(h);
    }
  });
  it("yayın runbook'u yeni ortam değişkenlerini anlatır", () => {
    const doc = src("docs/runbooks/ILAN_KONTROL_EKLENTI_YAYIN.md");
    for (const v of ["NEXT_PUBLIC_LISTING_EXTENSION_CWS_URL", "NEXT_PUBLIC_LISTING_EXTENSION_EDGE_URL", "NEXT_PUBLIC_LISTING_EXTENSION_ID"]) {
      expect(doc, v).toContain(v);
    }
  });
});

describe("kurulum sonrası otomatik bağlama ve anında kanıt (0.3.1)", () => {
  const bg = src(`${EXT}/src/background.ts`);
  const content = src(`${EXT}/src/content.ts`);
  const setup = src("src/components/listing-control/sync-setup.tsx");
  it("sürüm 0.3.1; manifest izinleri genişlemedi (tabs izni gerekmez)", () => {
    const manifest = JSON.parse(src(`${EXT}/manifest.base.json`)) as { version: string; permissions: string[] };
    expect(EXTENSION_VERSION).toBe("0.3.1");
    expect(manifest.version).toBe("0.3.1");
    expect(manifest.permissions).toEqual(["storage", "alarms"]);
  });
  it("onInstalled: yalnız ilk kurulumda, yalnız derleme kökeniyle EmlakSoft sekmesi açar; bağlamaz", () => {
    const block = bg.slice(bg.indexOf("chrome.runtime.onInstalled.addListener"), bg.indexOf("chrome.runtime.onStartup"));
    expect(block).toContain("shouldOpenInstallLanding(details.reason)");
    expect(block).toContain("installLandingUrl(__EMLAKSOFT_APP_ORIGINS__)");
    expect(block).toContain("chrome.tabs.create({ url: landing })");
    expect(block).not.toMatch(/setConnected|STORAGE_KEYS\.pairing|scanNow/);
    expect(bg.match(/tabs\.create/g)?.length).toBe(1);
  });
  it("dış kanal hâlâ yalnız ping: tarama/bağlama yalnız içerik betiği köprüsünden", () => {
    const ext = bg.slice(bg.indexOf("onMessageExternal.addListener"));
    expect(ext).toContain('m.kind !== "ping"');
    expect(ext).not.toMatch(/scan|setConnected|tabs\.create/);
    expect(content).toContain("isTrustedScanRequest(");
    expect(content).toContain("isTrustedConnectRequest(");
  });
  it("sayfa: ?bagla=1 yalnız düğmeyi öne çıkarır; bağlama tıklamayla, ardından şimdi-tara; URL temizlenir", () => {
    expect(setup).toContain("requestConnect()");
    expect(setup).toContain("requestScanNow()");
    expect(setup).toContain("router.replace(pathname)");
    expect(src("src/app/app/ilan-kontrol/page.tsx")).toContain('sp.bagla === "1"');
    expect(src("src/lib/supabase/middleware.ts")).toContain("?bagla=1");
  });
  it("saat/Date.now yok: algılama ve tarama görünümü saf modüller", () => {
    for (const f of ["browser-detect.ts", "extension-install.ts", "scan-run-view.ts"]) {
      expect(src(`src/lib/listing-control/worker/${f}`), f).not.toMatch(/Date\.now|new Date\(/);
    }
    expect(src("src/components/listing-control/sync-install-step.tsx")).not.toMatch(/Date\.now|new Date\(/);
  });
});
