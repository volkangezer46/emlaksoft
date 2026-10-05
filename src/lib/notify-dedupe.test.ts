import { describe, expect, it } from "vitest";
import {
  buildDedupeKey,
  isMissingDedupeColumn,
  isUniqueViolation,
  stripDedupeKey,
  timeBucket,
  uniqueByDedupeKey,
} from "@/lib/notify-dedupe";

describe("bildirim dedupe", () => {
  it("anahtar deterministik ve 200 karakterle sınırlı", () => {
    expect(buildDedupeKey("portal-teyit", "abc", 5)).toBe("portal-teyit:abc:5");
    expect(buildDedupeKey("x", "a b")).toBe("x:a_b");
    expect(buildDedupeKey("x", "y".repeat(500)).length).toBe(200);
  });

  it("24 saat kovası aynı pencerede aynı, sonraki pencerede farklı", () => {
    const day = 24 * 3_600_000;
    expect(timeBucket(day * 10 + 1, day)).toBe(timeBucket(day * 10 + day - 1, day));
    expect(timeBucket(day * 11, day)).toBe(timeBucket(day * 10, day) + 1);
  });

  it("kolon-yok ve benzersiz-ihlal hatalarını ayırır", () => {
    expect(isMissingDedupeColumn({ code: "42703", message: 'column "dedupe_key" of relation "notifications" does not exist' })).toBe(true);
    expect(isMissingDedupeColumn({ code: "PGRST204", message: "Could not find the 'dedupe_key' column of 'notifications' in the schema cache" })).toBe(true);
    expect(isMissingDedupeColumn({ code: "23505", message: "duplicate key value violates unique constraint" })).toBe(false);
    expect(isMissingDedupeColumn(null)).toBe(false);
    expect(isUniqueViolation({ code: "23505", message: "x" })).toBe(true);
    expect(isUniqueViolation({ message: "duplicate key value violates unique constraint" })).toBe(true);
    expect(isUniqueViolation({ code: "42703", message: "x" })).toBe(false);
  });

  it("stripDedupeKey eski şemaya yazılacak satırdan alanı çıkarır", () => {
    const [row] = stripDedupeKey([{ tenant_id: "t", title: "a", dedupe_key: "k" }]);
    expect(row).toEqual({ tenant_id: "t", title: "a" });
  });

  it("uniqueByDedupeKey toplu içindeki yinelenen anahtarı ayıklar, anahtarsızı korur", () => {
    const rows = [
      { tenant_id: "t1", dedupe_key: "a" },
      { tenant_id: "t1", dedupe_key: "a" },
      { tenant_id: "t2", dedupe_key: "a" },
      { tenant_id: "t1", dedupe_key: null },
      { tenant_id: "t1", dedupe_key: null },
    ];
    expect(uniqueByDedupeKey(rows)).toHaveLength(4);
  });
});
