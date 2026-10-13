import { beforeEach, describe, expect, it, vi } from "vitest";

const ID = "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const media = {
  id: ID,
  alt: "Ofis",
  w: 1600,
  h: 900,
  lqip: "",
  variants: [
    { file: "960w-0a1b2c3d.avif", w: 960, h: 540, format: "avif", bytes: 3 },
    { file: "960w-0a1b2c3d.webp", w: 960, h: 540, format: "webp", bytes: 3 },
  ],
};

const getSiteMediaView = vi.fn(async (id: string) => (id === ID ? media : null));
const downloadVariant = vi.fn(async () => Buffer.from([1, 2, 3]));
vi.mock("@/lib/site-media/store", () => ({ getSiteMediaView: (id: string) => getSiteMediaView(id), downloadVariant: () => downloadVariant() }));

import { GET } from "./route";

const call = (id: string, file: string) => GET(new Request(`https://emlaksoft.com.tr/medya/${id}/${file}`), { params: Promise.resolve({ id, file }) });

describe("/medya/[id]/[file] sunumu", () => {
  beforeEach(() => {
    downloadVariant.mockClear();
  });

  it("kayıtlı varyant: nosniff + sandbox CSP + kalıcı (immutable) önbellek + doğru tür", async () => {
    const res = await call(ID, "960w-0a1b2c3d.avif");
    expect(res.status).toBe(200);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("content-type")).toBe("image/avif");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("bilinmeyen varyant, `..` içeren ad, bozuk kimlik ve bilinmeyen medya 404 (depoya gidilmez)", async () => {
    for (const [id, file] of [
      [ID, "1600w-0a1b2c3d.avif"], // desene uyar ama kayıtlı değil
      [ID, "960w-ffffffff.webp"],
      [ID, "../secret.avif"],
      [ID, "..%2F960w-0a1b2c3d.avif"],
      [ID, "960w-0a1b2c3d.avif/.."],
      [ID, "960w-0a1b2c3d.svg"],
      ["../../etc", "960w-0a1b2c3d.avif"],
      ["not-a-uuid", "960w-0a1b2c3d.avif"],
      ["00000000-0000-4000-8000-000000000000", "960w-0a1b2c3d.avif"],
    ] as const) {
      const res = await call(id, file);
      expect(res.status, `${id}/${file}`).toBe(404);
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    }
    expect(downloadVariant).not.toHaveBeenCalled();
  });
});
