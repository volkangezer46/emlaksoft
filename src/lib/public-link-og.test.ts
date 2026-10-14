import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

/**
 * YD2 kabul (önizleme tarafı): sunum linkinin WhatsApp önizlemesi OFİS adıyla ve İLK ilanın görseliyle çizilir.
 * Kapı geçmeyen token (pasif ofis, kapalı modül, ilansız sunum) içerik taşımaz; belge linkleri yalnız ofis + tür.
 */
type Row = Record<string, unknown>;

const TOKEN = "11111111-1111-4111-8111-111111111111";
const P1 = "33333333-3333-4333-8333-333333333333";
const P2 = "44444444-4444-4444-8444-444444444444";

const h = vi.hoisted(() => ({
  presentation: null as Row | null,
  properties: [] as Row[],
  media: [] as Row[],
  closed: false,
  photoBytes: null as Buffer | null,
  downloaded: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/modules/public", () => ({ isPublicFeatureClosed: async () => h.closed }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is", "in", "order", "limit"]) chain[m] = () => chain;
      chain.maybeSingle = async () => ({ data: table === "presentations" ? h.presentation : null, error: null });
      chain.then = (resolve: (r: unknown) => unknown) =>
        Promise.resolve({ data: table === "properties" ? h.properties : table === "property_media" ? h.media : [], error: null }).then(resolve);
      return chain;
    },
    storage: {
      from: () => ({
        download: async (path: string) => {
          h.downloaded.push(path);
          return h.photoBytes ? { data: new Blob([new Uint8Array(h.photoBytes)]), error: null } : { data: null, error: { message: "yok" } };
        },
      }),
    },
  }),
}));

import { loadOgPhoto, loadPresentationOg, publicLinkMetadata } from "./public-link-og";
import { renderVitrinOg } from "./vitrin-og";

beforeEach(() => {
  h.presentation = {
    tenant_id: "t-1",
    title: "Ayşe Hanım için seçki",
    property_ids: [P1, P2],
    tenant: { name: "Deniz Emlak", status: "active", logo_url: null, brand_color: "#0f766e" },
  };
  h.properties = [
    { id: P2, status: "live", province: { name: "İstanbul" }, district: { name: "Beşiktaş" } },
    { id: P1, status: "live", province: { name: "İstanbul" }, district: { name: "Kadıköy" } },
  ];
  h.media = [];
  h.closed = false;
  h.photoBytes = null;
  h.downloaded = [];
});

describe("loadPresentationOg", () => {
  it("ofis adı + sunum başlığı; ilan sırası sunumdaki seçim sırasıdır (ilk ilan fotoğraf adayı)", async () => {
    const og = await loadPresentationOg(TOKEN);
    expect(og).toMatchObject({
      office: "Deniz Emlak",
      title: "Ayşe Hanım için seçki",
      brandColor: "#0f766e",
      location: "Kadıköy, İstanbul",
      specs: ["2 portföy"],
      photoPropertyIds: [P1, P2],
    });
    const meta = publicLinkMetadata(og, "Portföy sunumu");
    expect(meta.title).toEqual({ absolute: "Ayşe Hanım için seçki · Deniz Emlak" });
    expect(meta.openGraph).toMatchObject({ siteName: "Deniz Emlak", title: "Ayşe Hanım için seçki · Deniz Emlak" });
    expect(meta.twitter).toMatchObject({ card: "summary_large_image" });
  });

  it("taslak ilan atlanır; pasif ofis, kapalı modül ve geçersiz token içerik vermez", async () => {
    h.properties = [{ id: P1, status: "draft" }, { id: P2, status: "live" }];
    expect((await loadPresentationOg(TOKEN))?.photoPropertyIds).toEqual([P2]);

    expect(await loadPresentationOg("gecersiz")).toBeNull();
    h.closed = true;
    expect(await loadPresentationOg(TOKEN)).toBeNull();
    h.closed = false;
    h.presentation = { ...h.presentation!, tenant: { name: "X", status: "suspended" } };
    expect(await loadPresentationOg(TOKEN)).toBeNull();
    expect(publicLinkMetadata(null, "Portföy sunumu")).toEqual({ title: "Portföy sunumu" });
  });
});

describe("loadOgPhoto + kart", () => {
  it("ilk ilanın ilk public görseli alınır (belge atlanır), JPEG'e çevrilir ve kart fotoğraflı çizilir", async () => {
    h.photoBytes = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#3366aa" } }).png().toBuffer();
    h.media = [
      { id: "m-doc", property_id: P1, kind: "image", file_type: "image/png", file_name: "tapu.png", is_document: true, storage_path: "t-1/doc.png", file_size: 10 },
      { id: "m-2", property_id: P2, kind: "image", file_type: "image/png", file_name: "salon.png", is_document: false, storage_path: "t-1/p2.png", file_size: 10 },
      { id: "m-1", property_id: P1, kind: "image", file_type: "image/png", file_name: "cephe.png", is_document: false, storage_path: "t-1/p1.png", file_size: 10 },
    ];
    const photo = await loadOgPhoto("t-1", [P1, P2]);
    expect(h.downloaded).toEqual(["t-1/p1.png"]);
    expect(photo).toMatch(/^data:image\/jpeg;base64,/);

    const res = await renderVitrinOg({ office: "Deniz Emlak", title: "Ayşe Hanım için seçki", specs: ["2 portföy"], photo });
    const png = Buffer.from(await res.arrayBuffer());
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    const meta = await sharp(png).metadata();
    expect([meta.width, meta.height]).toEqual([1200, 630]);
  }, 30_000);

  it("görsel yok/indirilemiyor → null (fotoğrafsız yedek kart)", async () => {
    expect(await loadOgPhoto("t-1", [P1])).toBeNull();
    h.media = [{ id: "m-1", property_id: P1, kind: "image", file_type: "image/png", file_name: "a.png", is_document: false, storage_path: "x", file_size: 10 }];
    expect(await loadOgPhoto("t-1", [P1])).toBeNull();
  });
});
