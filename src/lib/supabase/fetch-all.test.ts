import { describe, expect, it } from "vitest";
import { fetchAllRows } from "./fetch-all";

const makeSource = (total: number, failAt?: number) => async (from: number, to: number) => {
  if (failAt !== undefined && from >= failAt) return { data: null, error: { message: "boom" } };
  const data: { id: number }[] = [];
  for (let i = from; i <= Math.min(to, total - 1); i += 1) data.push({ id: i });
  return { data, error: null };
};

describe("fetchAllRows", () => {
  it("1000 satır sınırını aşan veriyi sayfalayıp eksiksiz toplar", async () => {
    const res = await fetchAllRows(makeSource(2500), 1000);
    expect(res.error).toBeNull();
    expect(res.data).toHaveLength(2500);
  });
  it("tam sayfa sınırında biten veride boş son sayfayı da okur", async () => {
    const res = await fetchAllRows(makeSource(2000), 1000);
    expect(res.error).toBeNull();
    expect(res.data).toHaveLength(2000);
  });
  it("küçük veride tek sayfa", async () => {
    const res = await fetchAllRows(makeSource(3), 1000);
    expect(res.data).toHaveLength(3);
  });
  it("sayfa hatasında error döner (sessiz eksik sayı yok)", async () => {
    const res = await fetchAllRows(makeSource(5000, 1000), 1000);
    expect(res.error?.message).toBe("boom");
  });
  it("sayfa üst sınırı aşılırsa hata döner", async () => {
    const res = await fetchAllRows(makeSource(10_000), 1000, 3);
    expect(res.error).not.toBeNull();
  });
});
