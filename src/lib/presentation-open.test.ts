import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * YD2 sunum açılış bildirimi: WhatsApp/Telegram önizleme botu linki çekince ne sayaç artar ne "Sunumunuz ilk kez
 * açıldı" bildirimi gider (aksi halde günlük dedupe hakkını bot harcar, müşterinin gerçek açılışı bildirilmez).
 */
const h = vi.hoisted(() => ({
  notify: vi.fn(async (..._args: unknown[]) => undefined),
  rpc: vi.fn(async (..._args: unknown[]) => ({ error: null })),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/notify", () => ({ notifyTenant: h.notify }));

import { recordPresentationOpen, recordShareOpen } from "./presentation-open";
import { isLinkPreviewHeaders, isLinkPreviewRequest } from "./link-preview";

const PRES = {
  id: "p-1",
  tenant_id: "t-1",
  title: "Kadıköy seçkisi",
  customer_name: "Ayşe Yılmaz",
  customer_id: "c-1",
  created_by: "u-1",
  view_count: 0,
};
const CHROME =
  "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36";
const SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

describe("isLinkPreviewRequest", () => {
  it.each([
    "WhatsApp/2.24.20.80 A",
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    "TelegramBot (like TwitterBot)",
    "Twitterbot/1.0",
    "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
    "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)",
    "Viber/22.0",
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "curl/8.5.0",
    "",
  ])("önizleyici/bot: %s", (ua) => {
    expect(isLinkPreviewRequest(ua)).toBe(true);
  });

  it("insan tarayıcısı sayılır, ön-yükleme sayılmaz", () => {
    expect(isLinkPreviewRequest(CHROME)).toBe(false);
    expect(isLinkPreviewRequest(SAFARI)).toBe(false);
    expect(isLinkPreviewRequest(null)).toBe(true);
    expect(isLinkPreviewRequest(CHROME, "prefetch;prerender")).toBe(true);
  });
});

describe("recordPresentationOpen", () => {
  beforeEach(() => {
    h.notify.mockClear();
    h.rpc.mockClear();
  });

  it("önizleme botu: sayaç da bildirim de yok", async () => {
    await recordPresentationOpen({ rpc: h.rpc } as never, PRES, {
      isPreviewBot: isLinkPreviewRequest("WhatsApp/2.24.20.80 A"),
      isCreatorPreview: false,
    });
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.notify).not.toHaveBeenCalled();
  });

  it("müşterinin gerçek açılışı: sayaç + günlük tekil bildirim", async () => {
    await recordPresentationOpen({ rpc: h.rpc } as never, PRES, {
      isPreviewBot: isLinkPreviewRequest(SAFARI),
      isCreatorPreview: false,
    });
    expect(h.rpc).toHaveBeenCalledWith("increment_presentation_view", { p_id: "p-1" });
    expect(h.notify).toHaveBeenCalledTimes(1);
    expect(h.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "t-1",
        userId: "u-1",
        title: "Sunumunuz ilk kez açıldı",
        href: "/app/musteriler/c-1?sekme=gecmis&kategori=portal",
        dedupeKey: expect.stringMatching(/^presentation-open:p-1:\d{4}-\d{2}-\d{2}$/),
      }),
    );
  });

  it("danışmanın kendi önizlemesi: sayaç artar, bildirim yok", async () => {
    await recordPresentationOpen({ rpc: h.rpc } as never, PRES, { isPreviewBot: false, isCreatorPreview: true });
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.notify).not.toHaveBeenCalled();
  });

  it("bildirim hatası yutulur", async () => {
    h.notify.mockRejectedValueOnce(new Error("push düştü"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      recordPresentationOpen({ rpc: h.rpc } as never, { ...PRES, view_count: 4 }, { isPreviewBot: false, isCreatorPreview: false }),
    ).resolves.toBeUndefined();
    spy.mockRestore();
  });
});

describe("SK8 B150: paylaşım linki açılışı (recordShareOpen)", () => {
  const SHARE = { token: "tok-1", tenant_id: "t-1", entity_id: "prop-1", notifyUserId: "u-1", label: "Moda 3+1" };
  const rpcReturning = (value: number | null, error: { message: string } | null = null) =>
    vi.fn(async (..._args: unknown[]) => ({ data: value, error }));

  beforeEach(() => h.notify.mockClear());

  it("WhatsApp önizleme botu (UA) ve ön-yükleme (Sec-Purpose): RPC de bildirim de yok", async () => {
    const rpc = rpcReturning(1);
    const wa = new Headers({ "user-agent": "WhatsApp/2.23.20.0 A" });
    await recordShareOpen({ rpc } as never, SHARE, { isPreviewBot: isLinkPreviewHeaders(wa) });
    const prefetch = new Headers({ "user-agent": CHROME, "sec-purpose": "prefetch" });
    await recordShareOpen({ rpc } as never, SHARE, { isPreviewBot: isLinkPreviewHeaders(prefetch) });
    expect(rpc).not.toHaveBeenCalled();
    expect(h.notify).not.toHaveBeenCalled();
  });

  it("gerçek ilk açılış: atomik RPC 1 döndürür → bildirim TAM bir kez", async () => {
    const rpc = rpcReturning(1);
    await recordShareOpen({ rpc } as never, SHARE, { isPreviewBot: isLinkPreviewHeaders(new Headers({ "user-agent": SAFARI })) });
    expect(rpc).toHaveBeenCalledWith("increment_share_view", { p_token: "tok-1" });
    expect(h.notify).toHaveBeenCalledTimes(1);
    expect(h.notify).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "t-1", userId: "u-1", title: "Paylaştığınız portföy linki açıldı", href: "/app/portfoyler/prop-1" }),
    );
  });

  it("eşzamanlı ikinci açılış (RPC 2), süresi dolmuş link (null) ve RPC hatası bildirim üretmez", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const rpc of [rpcReturning(2), rpcReturning(null), rpcReturning(null, { message: "yok" })]) {
      await recordShareOpen({ rpc } as never, SHARE, { isPreviewBot: false });
      expect(rpc).toHaveBeenCalledTimes(1);
    }
    expect(h.notify).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("aktif oluşturan yoksa sayaç artar ama bildirim gitmez", async () => {
    const rpc = rpcReturning(1);
    await recordShareOpen({ rpc } as never, { ...SHARE, notifyUserId: null }, { isPreviewBot: false });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(h.notify).not.toHaveBeenCalled();
  });
});
