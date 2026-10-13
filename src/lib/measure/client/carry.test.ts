import { describe, expect, it, vi } from "vitest";
import { CARRY_KEY, CARRY_TTL_MS, captureTouch, decorateHref, installCarry, utmOf, type CarryLocation, type CarryStorage } from "./carry";

/**
 * Atıf taşıma (tarayıcı modülü) — DOM'suz test: proje vitest ortamı `node` (jsdom bilerek kurulu değil, bkz.
 * vitest.config.ts); sessionStorage/belge/bağlantı yerine aynı yüzeye sahip sahte nesneler kullanılır.
 */
const T0 = 1_760_000_000_000;

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const s: CarryStorage & { data: Map<string, string>; getItem: ReturnType<typeof vi.fn>; setItem: ReturnType<typeof vi.fn> } = {
    data,
    getItem: vi.fn((k: string) => data.get(k) ?? null),
    setItem: vi.fn((k: string, v: string) => void data.set(k, v)),
  };
  return s;
}

function fakeDoc() {
  const listeners: ((e: { target: unknown }) => void)[] = [];
  return {
    listeners,
    addEventListener: vi.fn((_t: "click", fn: (e: { target: unknown }) => void) => void listeners.push(fn)),
    click(target: unknown) {
      for (const l of listeners) l({ target });
    },
  };
}

function anchor(href: string) {
  const a = {
    attrs: new Map([["href", href]]),
    getAttribute: (n: string) => a.attrs.get(n) ?? null,
    setAttribute: vi.fn((n: string, v: string) => void a.attrs.set(n, v)),
  };
  return { a, target: { closest: (sel: string) => (sel === "a[href]" ? a : null) } };
}

const loc = (path: string, search = ""): CarryLocation => ({ pathname: path, search, host: "emlaksoft.com.tr", origin: "https://emlaksoft.com.tr" });

describe("atıf taşıma kapalıyken", () => {
  it("sessionStorage'a dokunmaz ve /kayit bağlantılarını değiştirmez", () => {
    const storage = fakeStorage();
    const storageFactory = vi.fn(() => storage);
    const doc = fakeDoc();
    installCarry(false, { storage: storageFactory, loc: loc("/fiyatlar", "?utm_source=google&utm_medium=cpc"), refHost: "www.google.com", doc, now: T0 });
    expect(storageFactory).not.toHaveBeenCalled();
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(doc.addEventListener).not.toHaveBeenCalled();
    const { a, target } = anchor("/kayit");
    doc.click(target);
    expect(a.setAttribute).not.toHaveBeenCalled();
    expect(a.getAttribute("href")).toBe("/kayit");
  });
});

describe("atıf taşıma açıkken", () => {
  it("girişte dokunuşu 30 dk saklar ve tıklamada /kayit bağlantısına ekler", () => {
    const storage = fakeStorage();
    const doc = fakeDoc();
    installCarry(true, {
      storage: () => storage,
      loc: loc("/araclar/kira-artisi", "?utm_source=google&utm_medium=cpc&utm_campaign=ekim&utm_term=emlak crm&utm_content=v2"),
      refHost: "www.google.com",
      doc,
      now: T0,
    });
    const saved = JSON.parse(storage.data.get(CARRY_KEY)!);
    expect(saved).toMatchObject({ lp: "/araclar/kira-artisi", h: "www.google.com", u: { s: "google", m: "cpc", c: "ekim", t: "emlak crm", o: "v2" } });
    expect(saved.x).toBe(T0 + CARRY_TTL_MS);

    const { a, target } = anchor("/kayit?plan=pro");
    doc.click(target);
    const next = new URL(a.getAttribute("href")!, "https://emlaksoft.com.tr");
    expect(next.pathname).toBe("/kayit");
    expect(next.searchParams.get("plan")).toBe("pro");
    expect(next.searchParams.get("lp")).toBe("/araclar/kira-artisi");
    expect(next.searchParams.get("src_host")).toBe("www.google.com");
    expect(next.searchParams.get("utm_term")).toBe("emlak crm");
    expect(next.searchParams.get("utm_content")).toBe("v2");
    expect(next.searchParams.get("utm_source")).toBe("google");
  });

  it("/kayit dışındaki ve dış kökenli bağlantılara dokunmaz", () => {
    const t = { lp: "/", h: "", u: {}, x: T0 + 1 };
    expect(decorateHref("/fiyatlar", "https://emlaksoft.com.tr", t)).toBeNull();
    expect(decorateHref("/kayit/tamamla", "https://emlaksoft.com.tr", t)).toBeNull();
    expect(decorateHref("https://baska.example/kayit", "https://emlaksoft.com.tr", t)).toBeNull();
    expect(decorateHref("https://emlaksoft.com.tr/kayit", "https://emlaksoft.com.tr", t)).toBe("/kayit?lp=%2F");
  });

  it("var olan parametreyi ezmez; yönlendiren yoksa src_host eklenmez", () => {
    const t = { lp: "/fiyatlar", h: "", u: { s: "x" }, x: T0 + 1 };
    const out = decorateHref("/kayit?utm_source=y#form", "https://emlaksoft.com.tr", t)!;
    expect(out).toBe("/kayit?utm_source=y&lp=%2Ffiyatlar#form");
  });

  it("site içi geçişte dokunuş korunur ve süresi uzar; yeni UTM/dış yönlendiren dokunuşu yeniler", () => {
    const storage = fakeStorage();
    captureTouch(storage, loc("/", "?utm_source=google"), "", T0);
    const second = captureTouch(storage, loc("/fiyatlar"), "emlaksoft.com.tr", T0 + 60_000);
    expect(second).toMatchObject({ lp: "/", u: { s: "google" }, x: T0 + 60_000 + CARRY_TTL_MS });
    const third = captureTouch(storage, loc("/araclar"), "t.co", T0 + 120_000);
    expect(third).toMatchObject({ lp: "/araclar", h: "t.co", u: {} });
    // Süresi dolmuş kayıt yeni giriş sayılır.
    const late = captureTouch(storage, loc("/kayit"), "", T0 + 120_000 + CARRY_TTL_MS + 1);
    expect(late).toMatchObject({ lp: "/kayit", h: "" });
  });

  it("depolama erişimi hata verirse sessizce geçer (try/catch)", () => {
    const broken: CarryStorage = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceeded");
      },
    };
    const doc = fakeDoc();
    expect(() =>
      installCarry(true, {
        storage: () => {
          throw new Error("SecurityError");
        },
        loc: loc("/"),
        refHost: "",
        doc,
        now: T0,
      }),
    ).not.toThrow();
    expect(() => captureTouch(broken, loc("/"), "", T0)).not.toThrow();
    expect(captureTouch(broken, loc("/"), "", T0).lp).toBe("/");
  });

  it("utmOf yalnız dolu etiketleri alır ve 64 karaktere keser", () => {
    expect(utmOf("?utm_source=a&utm_medium=&x=1")).toEqual({ s: "a" });
    expect(utmOf(`?utm_campaign=${"k".repeat(80)}`).c).toHaveLength(64);
  });
});
