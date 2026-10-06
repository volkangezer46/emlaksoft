import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(file: string): string {
  return readFileSync(file, "utf8");
}

const mainContentShells = [
  "src/components/auth/auth-shell.tsx",
  "src/components/legal-page.tsx",
  "src/components/public/token-page.tsx",
  "src/components/public/portal-kit.tsx",
  "src/app/musteri-portali/[token]/page.tsx",
  "src/app/malik-portali/[token]/page.tsx",
] as const;

const directPublicMainPages = [
  "src/app/page.tsx",
  "src/app/danisman/[slug]/page.tsx",
  "src/app/vitrin/[slug]/page.tsx",
  "src/app/vitrin/[slug]/[id]/page.tsx",
  "src/app/vitrin/[slug]/favoriler/page.tsx",
  "src/app/vitrin/[slug]/degerleme/page.tsx",
] as const;

describe("navigation accessibility contract", () => {
  it("keeps one skip-link target in every shared public page shell", () => {
    expect(source("src/app/layout.tsx")).toContain('href="#main-content"');

    for (const file of mainContentShells) {
      expect(source(file).match(/id="main-content"/g), file).toHaveLength(1);
    }
  });

  it("keeps the global skip link valid on direct public page layouts", () => {
    for (const file of directPublicMainPages) {
      expect(source(file).match(/id="main-content"/g), file).toHaveLength(1);
    }
  });

  it("labels application and site navigation landmarks", () => {
    const sidebar = source("src/components/app/app-sidebar.tsx");
    const siteHeader = source("src/components/site-menu/mega-menu.tsx");

    // Landmark etiketi NavScroller (ortak <nav>) üzerinden verilir.
    expect(sidebar).toContain('label="Uygulama ana menüsü"');
    expect(source("src/components/ui/console/nav-kit.tsx")).toContain("aria-label={label}");
    expect(siteHeader).toContain('aria-label="Ana site navigasyonu"');
    expect(siteHeader).toContain('aria-label="Mobil site navigasyonu"');
  });

  it("keeps tablet navigation on the drawer breakpoint", () => {
    const sidebar = source("src/components/app/app-sidebar.tsx");

    expect(sidebar).toContain('responsiveClassName="lg:hidden"');
    // Masaüstü menü yalnız lg ve üstünde (tablet çekmece kullanır); zemin token sınıfı `sb-surface`.
    expect(sidebar).toMatch(/className="shell-aside sb-surface[^"]*\blg:flex"/);
  });

  it("gives the billing switch a stable accessible name", () => {
    expect(source("src/components/pricing.tsx")).toContain(
      'aria-label="Yıllık faturalandırma"',
    );
  });

  it("satış akışında demo/görüşme talebi yok: ana sayfa, menü ve fiyat yüzeyleri self-servis (kayıt ve fiyatlar)", () => {
    // Bölümler src/components/marketing altında ayrı dosyalardır: page + marketing/** + footer toplamı.
    const marketingFiles = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? marketingFiles(`${dir}/${e.name}`) : /\.tsx$/.test(e.name) ? [`${dir}/${e.name}`] : [],
      );
    const home = [
      "src/app/page.tsx",
      ...marketingFiles("src/components/marketing"),
      "src/components/site-footer.tsx",
      "src/lib/site-menu/defaults.ts",
      "src/lib/site-content/defaults.ts",
    ]
      .map(source)
      .join("\n");

    expect(home).not.toMatch(/"\/demo"/);
    expect(home).not.toMatch(/Demo görüşmesi planla/i);
    expect(home).toContain("/kayit");
    expect(home.toLocaleLowerCase("tr-TR")).not.toContain("canlı demo");
  });

  it("uses keyboard-managed primitives for dense application popovers", () => {
    const notifications = source("src/components/app/notification-bell-panel.tsx");
    const transition = source("src/app/app/anlasmalar/status-transition.tsx");

    expect(notifications).toContain('from "@/components/ui/popover"');
    expect(notifications).toContain("<PopoverContent");
    expect(notifications).toContain('role="tablist"');
    expect(notifications).toContain('role="tabpanel"');
    expect(notifications).not.toContain('className="fixed inset-0');

    expect(transition).toContain('from "@/components/ui/dropdown-menu"');
    expect(transition).toContain("<DropdownMenuContent");
    expect(transition).not.toContain('className="fixed inset-0');
  });

  it("keeps the deal board drag-and-drop usable by keyboard, touch and screen readers", () => {
    const board = source("src/app/app/anlasmalar/deal-board.tsx");
    const dnd = source("src/app/app/anlasmalar/board-dnd.ts");
    const logic = source("src/app/app/anlasmalar/board-logic.ts");

    // Yerel HTML5 sürükleme (dokunmatikte ve klavyede çalışmaz) geri gelmez.
    expect(board).not.toContain("dataTransfer");
    expect(board).not.toContain("onDrop=");
    expect(board).not.toMatch(/\sdraggable(\s|>|=\{true\})/);

    // Üç giriş yolu: fare/kalem (6 px), dokunma (basılı tutma), klavye (sütun sütun).
    expect(board).toContain("useSensor(BoardPointerSensor, POINTER_SENSOR_OPTIONS)");
    expect(board).toContain("useSensor(BoardTouchSensor, TOUCH_SENSOR_OPTIONS)");
    expect(board).toContain("useSensor(KeyboardSensor,");
    expect(dnd).toContain("activationConstraint: { distance: 6 }");
    expect(dnd).toMatch(/activationConstraint: \{ delay: 200, tolerance: \d+ \}/);
    expect(dnd).toContain('event.pointerType === "touch"');
    expect(dnd).toContain("coordinateGetter: boardKeyboardCoordinates");
    expect(dnd).toContain("start: [KeyboardCode.Space, KeyboardCode.Enter]");
    expect(dnd).toContain("cancel: [KeyboardCode.Esc, KeyboardCode.Tab]");

    // Klavye ve ekran okuyucu tutamağı: dnd-kit role/aria/tabIndex öznitelikleri, 44 px dokunma alanı.
    expect(board).toContain("ref={setActivatorNodeRef}");
    expect(board).toContain("{...attributes}");
    expect(board).toContain("aria-label={`${title} anlaşmasını taşı`}");
    expect(board).toMatch(/ref=\{setActivatorNodeRef\}[\s\S]{0,400}h-11 w-11[^"]*touch-none/);

    // Türkçe duyurular ve kullanım talimatı; talimat kimliği hidrasyonda sabit (useId).
    expect(board).toContain("announcements,");
    expect(board).toContain("screenReaderInstructions: { draggable: BOARD_SCREEN_READER_INSTRUCTIONS }");
    expect(board).toContain("id={dndId}");
    for (const text of ["alındı", "aşamasına taşındı", "Taşıma iptal edildi", "kapanış sihirbazı açılıyor"]) {
      expect(logic, text).toContain(text);
    }

    // Önizleme katmanı, sütun hedefi, kenarda otomatik kaydırma.
    expect(board).toContain("<DragOverlay");
    expect(board).toContain("useDroppable({ id: stage })");
    expect(board).toContain("autoScroll={BOARD_AUTO_SCROLL}");

    // Yetki: düzenleme izni yoksa sürükleme kapalı ve eylem üretilmez.
    expect(board).toContain("disabled: !canEdit || busy");
    expect(logic).toContain('if (!input.canEdit) return { kind: "none", reason: "forbidden" };');

    // Hareket azaltma: bırakma geçişi, önizleme geçişi ve klavye kaydırması animasyonsuz.
    expect(board).toContain("dropAnimation={reducedMotion ? null : DROP_ANIMATION}");
    expect(board).toContain('transition={reducedMotion ? "none" : undefined}');
    expect(board).toContain("reducedMotion ? KEYBOARD_SENSOR_OPTIONS_REDUCED : KEYBOARD_SENSOR_OPTIONS");
    expect(dnd).toMatch(/KEYBOARD_SENSOR_OPTIONS_REDUCED[\s\S]{0,120}scrollBehavior: "auto"/);
  });

  it("loads the drag-and-drop library only with the deal board chunk", () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(`${dir}/${e.name}`) : /\.tsx?$/.test(e.name) ? [`${dir}/${e.name}`] : [],
      );
    const sources = walk("src").filter((file) => !file.endsWith(".test.ts"));

    expect(sources.filter((file) => /from "@dnd-kit\//.test(source(file))).sort()).toEqual([
      // Admin "Site menüsü" editörü: yalnız /admin/site-menu rotasının kendi parçasında (herkese açık sayfalara girmez).
      "src/app/admin/site-menu/menu-tab.tsx",
      "src/app/app/anlasmalar/board-dnd.ts",
      "src/app/app/anlasmalar/deal-board.tsx",
    ]);

    // Pano yalnız tembel kapıdan (ayrı parça) yüklenir: liste görünümü (?gorunum=liste) onu indirmez.
    const valueImporters = (module: string) =>
      sources.filter((file) => new RegExp(`import \\{[^}]*\\} from "[^"]*/${module}";`).test(source(file)));
    expect(valueImporters("deal-board")).toEqual([]);
    expect(valueImporters("board-dnd")).toEqual(["src/app/app/anlasmalar/deal-board.tsx"]);

    const page = source("src/app/app/anlasmalar/page.tsx");
    const gate = source("src/app/app/anlasmalar/deal-board-lazy.tsx");
    expect(page).toContain('import { DealBoard } from "./deal-board-lazy";');
    expect(page).toContain('import type { BoardDeal } from "./deal-board";');
    expect(gate.startsWith('"use client";')).toBe(true);
    expect(gate).toContain('dynamic(() => import("./deal-board")');
    expect(gate).not.toContain("ssr: false");
  });

  it("does not render missing public media URLs as deceptive hash links", () => {
    for (const file of [
      "src/app/vitrin/[slug]/[id]/page.tsx",
      "src/app/paylas/[token]/page.tsx",
    ]) {
      const content = source(file);
      expect(content, file).toContain("normalizeExternalHref");
      expect(content, file).not.toContain('external_url ?? "#"');
    }
  });

  it("labels icon-only geographic administration controls", () => {
    for (const file of [
      "src/app/admin/geo/province-row.tsx",
      "src/app/admin/geo/entity-list.tsx", // il/ilçe/mahalle ortak satır bileşeni
    ]) {
      const content = source(file);
      expect(content, file).toContain("aria-label=");
      expect(content, file).toContain('role="alert"');
      expect(content, file).not.toContain('{pending ? "..." : "Kaydet"}');
    }
  });

  it("announces shared route loading states without forcing motion", () => {
    const rootLoading = source("src/components/route-splash.tsx");
    const sharedSkeleton = source("src/components/ui/skeleton.tsx");

    expect(rootLoading).toContain('role="status"');
    expect(rootLoading).toContain('aria-busy="true"');
    expect(rootLoading).toContain("motion-safe:animate-pulse");
    expect(rootLoading).not.toContain('className="grid h-10 w-10 animate-pulse');

    expect(sharedSkeleton.match(/role="status"/g)).toHaveLength(3);
    expect(sharedSkeleton.match(/aria-busy="true"/g)).toHaveLength(3);
  });
});
