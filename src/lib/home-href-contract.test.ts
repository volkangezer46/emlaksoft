import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_MATRIX, type AppAction, type AppModule, type AppRole } from "@/lib/permissions";
import type { EffectivePermissions } from "@/lib/permissions-effective";
import {
  buildFirstTasks,
  buildOnboarding,
  scopeOnboardingToPermissions,
  visibleFirstTasks,
  type OnboardingFacts,
} from "@/lib/onboarding-checklist";
import { buildNextActions, onboardingNextOf, taskEmptyAction, type NextActionInput } from "@/app/app/_home/siradaki";

/**
 * SÖZLEŞME (B184-e): ana ekranın ürettiği her bağlantı, o rolün açabildiği sayfaya gider. Sayfanın kapısı kaynaktan okunur
 * (`requireModulePage("<modül>")`), oluşturma akışlarında (yeni kayıt, içe aktarma, hızlı ekle) ayrıca oluşturma izni gerekir.
 * 8 rolde "Bu sayfa rolünüz için kapalı" ekranına giden bağlantı sayısı 0 olmalı.
 */

const ROLES = Object.keys(DEFAULT_MATRIX) as AppRole[];
const ROOT = process.cwd();

function permsOf(role: AppRole): EffectivePermissions {
  return { ...DEFAULT_MATRIX[role] } as EffectivePermissions;
}

function has(perms: EffectivePermissions, module: AppModule, action: AppAction): boolean {
  return (perms[module] ?? []).includes(action);
}

/** Bağlantının sayfa dosyası; `/app` ana ekranı rota grubunda da olabilir. */
function pageFile(path: string): string | null {
  // Next rota grupları (`(bugun)`, `(merkez)`) yolu değiştirmez: her bölümde grup klasörleri de denenir.
  let dirs = [join(ROOT, "src/app")];
  const expand = (ds: string[]) => ds.flatMap((d) => [d, ...(existsSync(d) ? readdirSync(d).filter((n) => n.startsWith("(")).map((n) => join(d, n)) : [])]);
  for (const seg of path.split("/").filter(Boolean)) dirs = expand(dirs).map((d) => join(d, seg)).filter((d) => existsSync(d));
  return expand(dirs).map((d) => join(d, "page.tsx")).find((f) => existsSync(f)) ?? null;
}

/** Sayfanın modül kapısı (ilk `requireModulePage("x")`). */
function gateOf(path: string): AppModule {
  const file = pageFile(path);
  if (!file) throw new Error(`Sayfa dosyası yok: ${path}`);
  const m = readFileSync(file, "utf8").match(/requireModulePage\(\s*"([a-z_]+)"/);
  if (!m) throw new Error(`Kapı bulunamadı: ${path}`);
  return m[1] as AppModule;
}

/** Oluşturma akışlarının ek şartı (sayfa görünse de kaydı oluşturamayan oraya yönlenmez). */
function createNeed(href: string): AppModule | null {
  const [path, query = ""] = href.split("?");
  if (path === "/app/hizli") {
    const tab = new URLSearchParams(query).get("sekme");
    const map: Record<string, AppModule> = { musteri: "customers", portfoy: "properties", randevu: "appointments", gorusme: "calls" };
    return tab ? (map[tab] ?? null) : null;
  }
  if (path === "/app/ice-aktarma") return "customers";
  if (path.endsWith("/yeni")) return gateOf(path);
  return null;
}

function blocked(href: string, perms: EffectivePermissions): string | null {
  const path = href.split("?")[0].split("#")[0];
  const gate = gateOf(path);
  if (!has(perms, gate, "view")) return `${href} → ${gate}:view yok`;
  const create = createNeed(href);
  if (create && !has(perms, create, "create")) return `${href} → ${create}:create yok`;
  return null;
}

const FACTS: OnboardingFacts = {
  officeLocationDone: false,
  youDone: false,
  members: 1,
  poolEnabled: false,
  poolAdvisorRecords: 0,
  publishedProperties: 0,
  activeIntegrations: 0,
  planPaid: false,
  extra: {},
};

const BUSY: Omit<NextActionInput, "perms" | "onboardingNext"> = {
  appointmentsToday: 2,
  firstAppointment: { time: "10:00", type: "Gösterim" },
  tasksOverdue: 1,
  hotLeads: 3,
  expiringAuthority: 1,
  unconfirmedListings: 2,
  pendingCommissionText: "₺1.000",
};
const QUIET: typeof BUSY = {
  appointmentsToday: 0,
  firstAppointment: null,
  tasksOverdue: 0,
  hotLeads: 0,
  expiringAuthority: 0,
  unconfirmedListings: 0,
  pendingCommissionText: null,
};

/** Rolün ana ekranında çizilebilecek tüm bağlantılar (yoğun ve sakin gün). */
function homeHrefs(role: AppRole): string[] {
  const perms = permsOf(role);
  const scoped = scopeOnboardingToPermissions(buildOnboarding(FACTS), perms);
  const onboardingNext = onboardingNextOf(scoped);
  const hrefs = new Set<string>();
  for (const input of [BUSY, QUIET]) for (const a of buildNextActions({ ...input, onboardingNext, perms })) hrefs.add(a.href);
  const zeros = { customers: 0, properties: 0, demands: 0, appointments: 0, customDefinitions: 0 };
  for (const t of visibleFirstTasks(buildFirstTasks(zeros), perms)) hrefs.add(t.href);
  for (const s of scoped.steps) hrefs.add(`/app/baslangic?adim=${s.id}`);
  const empty = taskEmptyAction(perms);
  if (empty) hrefs.add(empty.href);
  return [...hrefs];
}

describe("ana ekran bağlantı sözleşmesi (8 rol)", () => {
  it("8 rol tanımlı", () => {
    expect(ROLES).toHaveLength(8);
  });

  for (const role of ROLES) {
    it(`${role}: ana ekrandaki her bağlantı rolün kapısından geçer`, () => {
      const closed = homeHrefs(role)
        .map((h) => blocked(h, permsOf(role)))
        .filter((x): x is string => x !== null);
      expect(closed).toEqual([]);
    });
  }

  it("muhasebe: satış ilk işleri yerine kendi ilk işleri, yedek eylem 'Komisyonları aç'", () => {
    const perms = permsOf("accounting");
    const tasks = visibleFirstTasks(buildFirstTasks({ customers: 0, properties: 0, demands: 0, appointments: 0, customDefinitions: 0 }), perms);
    expect(tasks.map((t) => t.id)).toEqual(["expense", "commission"]);
    const fallback = buildNextActions({ ...QUIET, onboardingNext: null, perms }).at(-1);
    expect(fallback?.label).toBe("Komisyonları aç");
  });

  it("salt okunur: 'Görev ekle' ve 'Müşteri ekle' yok", () => {
    const perms = permsOf("readonly");
    expect(taskEmptyAction(perms)).toBeNull();
    const fallback = buildNextActions({ ...QUIET, onboardingNext: null, perms }).at(-1);
    expect(fallback?.label).toBe("Müşterilere göz at");
  });

  it("danışmanın kart sayacı ile sihirbaz sayacı aynı süzgeçten gelir", () => {
    const wizard = readFileSync(join(ROOT, "src/app/app/baslangic/page.tsx"), "utf8");
    const card = readFileSync(join(ROOT, "src/app/app/_home/baslangic-karti.tsx"), "utf8");
    expect(wizard).toMatch(/scopeOnboardingToPermissions\(snap\.state, perms, skipped\)/);
    expect(card).toMatch(/scopeOnboardingToPermissions\(snap\.state, ctx\.perms, snap\.skipped\)/);
    const advisor = scopeOnboardingToPermissions(buildOnboarding(FACTS), permsOf("advisor"));
    expect(advisor.steps.map((s) => s.id)).toEqual(["you"]);
    expect(advisor.total).toBe(1);
  });
});
