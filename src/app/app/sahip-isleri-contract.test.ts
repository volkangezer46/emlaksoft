import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ADVANCED_SETTINGS_HREFS } from "./ayarlar/_sekmeler/advanced";
import { visibleSettingsDirectory } from "./ayarlar/_sekmeler/settings-directory";
import { expenseNoun } from "./finans/(merkez)/_tabs/insight-links";

/**
 * SAHİP İŞLERİ (sadeleştirme B6, C21–C26) — kaynak düzeyinde kabul kilitleri. Ekran ölçümleri (y konumu, ilk ekrandaki
 * satır sayısı, iki ekranda aynı alacak tutarı) `e2e/sahip-isleri.spec.ts`'tedir; bu test geri kaymayı derlemeden yakalar.
 */
const read = (p: string) => readFileSync(join(process.cwd(), "src/app/app", p), "utf8");

describe("C21 Onaylar", () => {
  const page = read("onaylar/page.tsx");
  const actions = read("onaylar/decision-controls.tsx");
  it("karar veren için varsayılan ?kim=bana&durum=bekliyor; 'Tümü' açıkça kim=hepsi", () => {
    expect(page).toMatch(/const defaultKim[^=]*= manager \? "bana" : ""/);
    expect(page).toContain('"hepsi"');
  });
  it("dengeli görünüm: filtreler telefonda 'Filtreler' altında; KPI ve grafik masaüstünde açık, telefonda Özet'te katlı", () => {
    expect(page).toContain('data-testid="onay-filtreler" data-fold-phone=""');
    expect(page).toContain("<SummaryFold simple={false} foldOnPhone");
  });
  it("satırdaki Onayla / Reddet her ekranda en az 44 px; sade görünümde Onayla tek dokunuş", () => {
    expect(actions).toMatch(/inline-flex min-h-11 items-center gap-1\.5 rounded-\[var\(--radius-control\)\] px-4 py-2 text-sm/);
    expect(actions).toContain('simple && !isRed ? queue("onaylandi", "")');
  });
});

describe("C22 Bildirimler", () => {
  const view = read("bildirimler/notifications-view.tsx");
  it("istatistik kartları yok; karar bekleyenler başta", () => {
    expect(view).not.toContain("Okunma oranı");
    expect(view).not.toContain('label: "Son 7 gün"');
    expect(view).toContain("Sizden karar bekleyenler");
    expect(view.indexOf("karar-bekleyenler")).toBeLessThan(view.indexOf('aria-label="Bildirim filtresi"'));
  });
  it("karar kuralı tek kaynaktan, sayaçlar tek tanımdan", () => {
    expect(view).toContain('from "@/lib/notification-decision"');
    expect(view).toContain("overdueTasksCountQuery");
  });
});

describe("C23 Satışı kapat", () => {
  const page = read("anlasmalar/[id]/page.tsx");
  it("başlıkta birincil 'Satışı kapat' sihirbazı açar; Kazanıldı hapı da", () => {
    expect(page).toContain('"Satışı kapat"');
    expect(page.match(/closingTabHref\(deal\.id, "won"\)/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
  it("Kapanış ikinci sekme; teknik olasılık metni yok", () => {
    const tabs = page.slice(page.indexOf("const tabDefs"), page.indexOf("];", page.indexOf("const tabDefs")));
    const ids = [...tabs.matchAll(/id: "([a-z]+)"/g)].map((m) => m[1]);
    expect(ids.slice(0, 2)).toEqual(["ozet", "kapanis"]);
    for (const t of ["istatistiksel model", "sistem tahmini", "daha iyimser", "Beklenen değer"]) expect(page).not.toContain(t);
  });
});

describe("C24 Finans", () => {
  it("ayrı 'Gelir ekle' / 'Gider ekle' düğmeleri (P2 15), tek birincil; kısayol açıklaması ekranda değil", () => {
    const quick = read("finans/(merkez)/quick-entry.tsx");
    expect(quick.match(/<ButtonLink\b/g)).toHaveLength(2);
    expect(quick).toMatch(/href=\{href\(\{ tab: "gelir" \}\)\}[^>]*>\s*Gelir ekle/);
    expect(quick).toMatch(/href=\{href\(\{ tab: "gider" \}\)\}[^>]*>\s*Gider ekle/);
    expect(quick.match(/variant="primary"/g)).toHaveLength(1);
    const overview = read("finans/(merkez)/_tabs/genel-bakis.tsx");
    expect(overview).not.toMatch(/>\s*Gelir ekle|>\s*Gider ekle/);
    expect(read("finans/(merkez)/_tabs/finance-shell.tsx")).not.toContain("G (gelir)");
  });
  it("alacak tek tanım: ana sayfa Para kartı ve Finans genel bakış aynı özetten (açık kalemler); cari listesi ayrı adlı net ölçü", () => {
    // R3 (2026-10-16): eskiden genel bakış cari net bakiyesini (₺58.351,11), ana sayfa açık kalem toplamını (₺592.051) gösteriyordu.
    const gb = read("finans/(merkez)/_tabs/genel-bakis.tsx");
    expect(gb).not.toContain("loadPartyTotals(");
    expect(gb).toContain("RECEIVABLE_LABEL");
    expect(gb).toContain("value: kpiMoney(receivable)");
    expect(read("_home/data.ts")).toContain("receivable: overview ? overview.receivableOpen : null");
    expect(read("_home/para-ozeti.tsx")).toContain("RECEIVABLE_LABEL");
    const pl = read("finans/(merkez)/cari/party-list.tsx");
    expect(pl).toContain("sumPartyBalances(");
    expect(pl).toContain("PARTY_NET_RECEIVABLE_LABEL");
    expect(pl).not.toMatch(/label: "Alacağımız"/);
  });
  it("gider formunda kamerayı doğrudan açan fiş düğmesi; iç anahtar sızmıyor", () => {
    const ui = read("finans/kayit/_components/entry-ui.tsx");
    const form = read("finans/kayit/_components/entry-form.tsx");
    expect(ui).toContain('capture="environment"');
    expect(form).toMatch(/<AttachmentField\s+id="ew-camera"\s+capture/);
    expect(form).not.toContain('name="ew-category"');
  });
  it("Komisyon sekmesi Ödenecek paylar ile açılır; analiz altta", () => {
    const k = read("finans/(merkez)/komisyon/page.tsx");
    expect(k.indexOf("<PayableShares")).toBeGreaterThan(0);
    expect(k.indexOf("<PayableShares")).toBeLessThan(k.indexOf("<PipelineForecastCard"));
    expect(k.indexOf("<PayableShares")).toBeLessThan(k.indexOf("<CommissionSimulator"));
  });
  it("kategori adı 'gider' ile bitiyorsa 'gideri gideri' yazılmaz", () => {
    expect(expenseNoun("Ofis gideri")).toBe("Ofis gideri");
    expect(expenseNoun("Ofis giderleri")).toBe("Ofis giderleri");
    expect(expenseNoun("Kira")).toBe("Kira gideri");
  });
});

describe("C25 Ekibim, devir ve karne", () => {
  it("Ekip sayfasında ikinci KPI şeridi yok; özet tablodan sonra katlı", () => {
    const ekip = read("ekip/page.tsx");
    expect(ekip).not.toContain("<KpiGrid");
    expect(ekip.indexOf('id="uyeler"')).toBeLessThan(ekip.indexOf('testId="ekip-ozet"'));
  });
  it("karne başlığı 'Danışman karnesi'; KPI adı yok", () => {
    const kpi = read("danisman-kpi/page.tsx");
    expect(kpi).toContain('title="Danışman karnesi"');
    expect(kpi).toContain('metadata = { title: "Danışman karnesi" }');
    expect(kpi).not.toContain("KPI Paneli");
  });
  it("devir sayfasında sayı gibi görünen bağlantı kartı yok", () => {
    const devir = read("ekip/devir/page.tsx");
    expect(devir).not.toContain('value: "Müşteriler"');
    expect(devir).not.toContain('value: "İzinler"');
  });
});

describe("C26 Raporlar ve Ayarlar", () => {
  it("geliştirici notu yok; En çok kullanılan raporlar var", () => {
    const r = read("raporlar/page.tsx");
    expect(r).not.toMatch(/sahte satış hattı|Gerçek toplulaştırma/);
    expect(r).toContain("<TopReports");
  });
  it("Ayarlar h1 sabit 'Ayarlar'; gelişmiş ayarlar dizinde gerçekten var ve katlanır", () => {
    const a = read("ayarlar/page.tsx");
    expect(a).toContain('title="Ayarlar"');
    expect(a).toContain("advanced={advanced}");
    const hrefs = new Set(visibleSettingsDirectory("owner", () => true).flatMap((c) => c.items.map((i) => i.href)));
    expect(ADVANCED_SETTINGS_HREFS).toHaveLength(6);
    for (const h of ADVANCED_SETTINGS_HREFS) expect(hrefs.has(h), h).toBe(true);
  });
});
