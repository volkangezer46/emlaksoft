import { describe, expect, it } from "vitest";
import { groupNotifications, notificationTimeLabel } from "./group-notifications";

const row = (id: string, title: string, kind = "warning", read = false) => ({
  id,
  title,
  kind,
  read_at: read ? "2026-10-14T00:00:00Z" : null,
  created_at: "2026-10-14T00:00:00Z",
});

describe("groupNotifications", () => {
  it("aynı başlık + tür tek satır, sayfa sırası korunur, en yeni kayıt temsilci", () => {
    const groups = groupNotifications([
      row("a", "Portal teyit gecikti"),
      row("b", "Günlük ofis özeti", "info"),
      row("c", "Portal teyit gecikti", "warning", true),
      row("d", "Portal teyit gecikti"),
      row("e", "Portal teyit gecikti", "danger"),
    ]);
    expect(groups.map((g) => [g.head.id, g.count])).toEqual([
      ["a", 3],
      ["b", 1],
      ["e", 1],
    ]);
    expect(groups[0].unreadIds).toEqual(["a", "d"]);
  });
});

describe("notificationTimeLabel", () => {
  const now = Date.parse("2026-10-14T12:00:00Z");
  it("'az önce' yalnız son 1 dakikada", () => {
    expect(notificationTimeLabel("2026-10-14T11:59:30Z", now)).toBe("az önce");
    expect(notificationTimeLabel("2026-10-14T11:58:00Z", now)).toBe("2 dk önce");
    expect(notificationTimeLabel("2026-10-14T09:00:00Z", now)).toBe("3 sa önce");
    expect(notificationTimeLabel("2026-10-10T12:00:00Z", now)).toBe("4 gün önce");
  });
  it("gelecek tarihli kayıt mutlak tarih gösterir", () => {
    const label = notificationTimeLabel("2026-12-18T10:00:00Z", now);
    expect(label).not.toBe("az önce");
    expect(label).toMatch(/2026/);
  });
});
