import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { apptAction, BUGUNUM_CAPS, buildBugunum, bugunumRowCount, overdueDaysOf, type BugunumApptInput } from "./bugunum-core";
import { teamDot, teamLine } from "./home-metrics";

const DAY = 86_400_000;
const dayStartMs = Date.UTC(2026, 9, 15, 21); // 16 Ekim 00:00 TRT
const appt = (id: string, hour: number, extra: Partial<BugunumApptInput> = {}): BugunumApptInput => ({
  id,
  at: dayStartMs + hour * 3_600_000,
  time: `${String(hour).padStart(2, "0")}:00`,
  type: "Yer gösterme",
  customer: `Müşteri ${id}`,
  phone: null,
  directions: null,
  pending: false,
  ...extra,
});
const base = {
  appts: [] as BugunumApptInput[],
  apptTotal: 0,
  calls: [],
  tasks: [],
  overdueCount: 0,
  overdueHref: "/app/gorevler?filter=overdue&mine=1",
  dayStartMs,
  apptHref: (id: string) => `/app/randevular?randevu=${id}`,
  taskHref: (id: string) => `/app/gorevler?gorev=${id}`,
};

describe("Bugünüm (C07): tek sıralı liste", () => {
  it("sıra: randevular → aranacaklar → gecikmiş görevler; boş grup çizilmez", () => {
    const groups = buildBugunum({
      ...base,
      appts: [appt("b", 15), appt("a", 10)],
      apptTotal: 2,
      calls: [{ key: "c1", customerId: "c1", name: "Ayşe", phone: "0532 000 00 00", href: "/app/musteriler/c1", reasons: ["Açık talep"] }],
      tasks: [{ id: "t1", title: "Sözleşmeyi gönder", dueAt: new Date(dayStartMs - 2 * DAY).toISOString() }],
      overdueCount: 1,
    });
    expect(groups.map((g) => g.id)).toEqual(["randevu", "ara", "gorev"]);
    // Randevular saat sırasıyla; ilk satır bir randevu.
    expect(groups[0]!.rows.map((r) => r.lead)).toEqual(["10:00", "15:00"]);
    expect(buildBugunum({ ...base, calls: [], tasks: [] })).toEqual([]);
  });

  it("her satırda TEK eylem: randevu yol tarifi > ara > aç; aranacak 'Ara'; görev 'Bitti'", () => {
    expect(apptAction({ directions: "https://maps/x", phone: "05320000000" }, "/r").kind).toBe("yol");
    expect(apptAction({ directions: null, phone: "0532 000 00 00" }, "/r")).toEqual({ kind: "ara", label: "Ara", href: "tel:05320000000" });
    expect(apptAction({ directions: null, phone: null }, "/r")).toEqual({ kind: "ac", label: "Aç", href: "/r" });
    const groups = buildBugunum({
      ...base,
      calls: [
        { key: "c1", customerId: "c1", name: "Ayşe", phone: "05320000000", href: "/app/musteriler/c1", reasons: [] },
        { key: "c2", customerId: "c2", name: "Telefonsuz", phone: null, href: "/app/musteriler/c2", reasons: [] },
      ],
      tasks: [{ id: "t1", title: "Ara", dueAt: new Date(dayStartMs - DAY).toISOString() }],
      overdueCount: 1,
    });
    expect(groups[0]!.rows.map((r) => r.action.kind)).toEqual(["ara", "ac"]);
    expect(groups[1]!.rows[0]!.action).toEqual({ kind: "bitti", label: "Bitti", taskId: "t1" });
  });

  it("tavanlar ilk ekranı sınırlar; fazlası 'Tümü' bağlantısına gider (görev sayısı rozetle aynı tanımdan)", () => {
    const appts = Array.from({ length: 8 }, (_, i) => appt(`r${i}`, 9 + i));
    const calls = Array.from({ length: 6 }, (_, i) => ({ key: `c${i}`, customerId: `c${i}`, name: `Kişi ${i}`, phone: "05320000000", href: `/app/musteriler/c${i}`, reasons: [] }));
    const tasks = Array.from({ length: 3 }, (_, i) => ({ id: `t${i}`, title: `Görev ${i}`, dueAt: new Date(dayStartMs - DAY).toISOString() }));
    const groups = buildBugunum({ ...base, appts, apptTotal: 11, calls, tasks, overdueCount: 9 });
    expect(bugunumRowCount(groups)).toBe(BUGUNUM_CAPS.randevu + BUGUNUM_CAPS.ara + BUGUNUM_CAPS.gorev);
    expect(bugunumRowCount(groups)).toBeLessThanOrEqual(11);
    expect(groups.find((g) => g.id === "randevu")).toMatchObject({ total: 11, moreHref: "/app/randevular" });
    expect(groups.find((g) => g.id === "ara")).toMatchObject({ total: 6, moreHref: "/app/arama-listesi" });
    expect(groups.find((g) => g.id === "gorev")).toMatchObject({ total: 9, moreHref: base.overdueHref });
  });

  it("bugün randevusu olan kişi aranacaklarda tekrar edilmez", () => {
    const groups = buildBugunum({
      ...base,
      appts: [appt("a", 11, { customer: "Ayşe Yılmaz" })],
      apptTotal: 1,
      calls: [{ key: "c1", customerId: "c1", name: "ayşe yılmaz", phone: "05320000000", href: "/x", reasons: [] }],
    });
    expect(groups.map((g) => g.id)).toEqual(["randevu"]);
  });

  it("gecikme günü TR gün başına göre; bugün içindeki gecikme 0 ('Bugün')", () => {
    expect(overdueDaysOf(new Date(dayStartMs - 3 * DAY + 3_600_000).toISOString(), dayStartMs)).toBe(3);
    expect(overdueDaysOf(new Date(dayStartMs + 3_600_000).toISOString(), dayStartMs)).toBe(0);
    const [g] = buildBugunum({ ...base, tasks: [{ id: "t", title: "x", dueAt: new Date(dayStartMs + 3_600_000).toISOString() }], overdueCount: 1 });
    expect(g!.rows[0]!.lead).toBe("Bugün");
  });

  it("satır eylem düğmeleri 44 px (h-11) ve görev eylemi her cihazda görünür (hover'a bağlı değil)", () => {
    const view = readFileSync("src/app/app/_home/bugunum.tsx", "utf8");
    const bitti = readFileSync("src/app/app/_home/bitti-dugmesi.tsx", "utf8");
    expect(view).toMatch(/className: "h-11 min-w-11 shrink-0"/);
    expect(bitti).toMatch(/className="h-11 min-w-11 shrink-0"/);
    expect(bitti).not.toContain("hover-action");
    // Gecikmiş görev sayısı alt çubuk rozetiyle aynı tanımdan (C10).
    expect(readFileSync("src/app/app/_home/data.ts", "utf8")).toMatch(/overdueTasksCountQuery\(supabase, ctx\.tenantId, ctx\.userId, nowIso\)/);
    expect(view).toContain("OVERDUE_TASKS_HREF");
  });
});

describe("Patron panosu ekip satırı (C08): renkli durum noktası", () => {
  const row = { id: "1", fullName: "A", callCount: 0, appointCount: 0, offerCount: 0, dealCount: 0, targetPct: null as number | null };
  it("hareket yoksa kırmızı; hedef yoksa ama hareket varsa yeşil; hedef varsa tempo", () => {
    expect(teamDot(row, 50)).toEqual({ status: "danger", label: "Bu ay hareket yok" });
    expect(teamDot({ ...row, callCount: 3 }, 50)).toEqual({ status: "ok", label: "Çalışıyor" });
    expect(teamDot({ ...row, callCount: 3, targetPct: 60 }, 50).status).toBe("ok");
    expect(teamDot({ ...row, callCount: 3, targetPct: 5 }, 80).status).toBe("danger");
    expect(teamLine({ callCount: 12, appointCount: 3, dealCount: 1 })).toBe("12 görüşme · 3 randevu · 1 anlaşma");
  });
});

describe("Ana ekran sadeleştirme sözleşmesi (C07/C08/C09)", () => {
  const page = readFileSync("src/app/app/(bugun)/page.tsx", "utf8");
  const hero = readFileSync("src/app/app/_home/ana-hero.tsx", "utf8");
  const program = readFileSync("src/app/app/_home/program.tsx", "utf8");
  it("'Ne yapmak istiyorsun?' kutusu ve çipleri kaldırıldı; kısayollar tek yerde", () => {
    expect(page).not.toMatch(/NeYapmak|neYapmakChips/);
    expect((page.match(/<BugunKisayol\b/g) ?? []).length).toBe(1);
  });
  it("TV modu yalnız '⋯' menüsünde ve telefonda gizli (md:flex)", () => {
    expect((hero.match(/^\s*TV modu\s*$/gm) ?? []).length).toBe(1);
    expect(hero).toMatch(/href="\/app\/pano-tv"[\s\S]{0,120}hidden[^"]*md:flex/);
  });
  it("program yalnız randevu gösterir: saatli/saatsiz görev programa girmez", () => {
    expect(program).not.toMatch(/loadTodayTimedTasks|taskHref|kind: "task"/);
    expect(readFileSync("src/app/app/_home/data.ts", "utf8")).not.toContain("loadTodayTimedTasks");
  });
  it("Para kartı ve Senden bekleyenler patron panosunun ilk satırında; öneri en çok 1", () => {
    expect(page).toMatch(/cell\(7, <SendenBekleyenler[\s\S]{0,200}cell\(5, <ParaOzeti/);
    const bekleyen = readFileSync("src/app/app/_home/senden-bekleyenler.tsx", "utf8");
    expect(bekleyen).toMatch(/pickBriefing\(bundle\.insights, bundle\.total, 1\)/);
    expect(bekleyen).toContain("InsightEylemKisa");
  });
});
