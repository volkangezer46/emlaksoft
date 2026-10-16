import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * TEK ŞERİT + MOBİL KART SÖZLEŞMESİ (konsey UX denetimi, bulgu 2).
 *  1) Bir /app sayfasında hub şeridine (section-tabs) EK ikinci sekme şeridi (PageTabs / MorphNav / DetailTabs) kullanılmaz;
 *     sayfanın kendi iç sekmeleri `SegmentTabs` (src/components/ui/segment-tabs.tsx) ile çizilir. Mevcut kullanımlar
 *     aşağıdaki istisna listesindedir ve YALNIZ AZALABİLİR (dosyayı düzeltince listeden çıkar).
 *  2) Geniş tablo (TableFrame minWidth >= 100) mobil kart alternatifi (MobileCard ya da kırılımla gizleme) olmadan
 *     kullanılmaz; mevcutlar istisna listesindedir ve YALNIZ AZALABİLİR.
 */
const STRIP_EXCEPTIONS = new Set<string>([]);

const WIDE_TABLE_EXCEPTIONS = new Set<string>([]);

const ROOT = process.cwd().replace(/\\/g, "/");

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx$/.test(name) && !/\.test\.tsx$/.test(name)) out.push(full.replace(/\\/g, "/"));
  }
  return out;
}

const FILES = ["src/app/app", "src/components/app"].flatMap((d) => walk(join(ROOT, d)).map((f) => f.slice(ROOT.length + 1)));
const SKIP = new Set(["src/components/app/detail-tabs.tsx", "src/components/app/section-tabs.tsx", "src/components/app/page-tabs.tsx"]);
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");

const SECOND_STRIP = /<(PageTabs|MorphNav|DetailTabs)\b/;
const WIDE_TABLE_TAG = /<TableFrame\b[^>]*minWidth=\{\d{3,4}[^>]*>/g;
/** `stack`: 768 px altında satırlar karta döner (başlık gizli, TD label hücre önünde; list-page.css `.tbl-stack`). */
const hasUnstackedWide = (code: string) => (code.match(WIDE_TABLE_TAG) ?? []).some((tag) => !/\bstack\b/.test(tag));
const MOBILE_ALT = /MobileCard|sm:hidden|md:hidden|lg:hidden|hidden sm:|hidden md:/;

describe("tek şerit ilkesi", () => {
  const using = FILES.filter((f) => !SKIP.has(f) && SECOND_STRIP.test(read(f)));
  it("yeni ikinci sekme şeridi eklenmez (SegmentTabs kullan)", () => {
    expect(using.filter((f) => !STRIP_EXCEPTIONS.has(f))).toEqual([]);
  });
  it("istisna listesi güncel: artık kullanmayan dosya listeden çıkarılır", () => {
    expect([...STRIP_EXCEPTIONS].filter((f) => !using.includes(f))).toEqual([]);
  });
  it("SegmentTabs: yatay kaydırma + 44px hedef + aria-current", () => {
    const code = read("src/components/ui/segment-tabs.tsx");
    expect(code).toContain("overflow-x-auto");
    expect(code).toContain("min-h-11");
    expect(code).toContain("aria-current");
  });
});

describe("geniş tablo mobil kart alternatifi", () => {
  const wide = FILES.filter((f) => hasUnstackedWide(read(f)) && !MOBILE_ALT.test(read(f)));
  it("yeni geniş tablo kart alternatifsiz eklenmez", () => {
    expect(wide.filter((f) => !WIDE_TABLE_EXCEPTIONS.has(f))).toEqual([]);
  });
  it("istisna listesi güncel: düzeltilen dosya listeden çıkarılır", () => {
    expect([...WIDE_TABLE_EXCEPTIONS].filter((f) => !wide.includes(f))).toEqual([]);
  });
  it("danışman tablosu 1024 px altında (telefon + tablet) kart listesine döner", () => {
    const code = read("src/components/app/office-center/advisor-table.tsx");
    expect(code).toContain("MobileCard");
    expect(code).toContain("lg:hidden");
    expect(code).toContain("hidden lg:block");
  });
});
