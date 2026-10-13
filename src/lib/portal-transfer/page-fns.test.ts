import { describe, expect, it } from "vitest";
import { applyActionsInPage, attachPhotosInPage, collectControlsInPage, readListHtmlInPage, readPageRefInPage, readValuesInPage } from "./page-fns";
import { planFill } from "./fill-plan";
import { buildPortalPayload, type PortalPropertyInput } from "./payload";

/**
 * Sayfa içi işlevler SERİLEŞTİRİLİP portal sekmesinde çalışır: dış değişken kullanamazlar. Test, işlevi `toString()` ile alıp
 * YALITILMIŞ kapsamda (`new Function`) yeniden kurar; dış başvuru varsa ReferenceError verir. DOM, bu kümeyi karşılayan
 * küçük bir sahtedir (vitest ortamı node; jsdom kurulmaz).
 */
const isolate = <T extends (...a: never[]) => unknown>(fn: T): T => new Function(`return (${fn.toString()})`)() as T;

class FakeEvent {
  constructor(public type: string) {}
}
type Attrs = Record<string, string>;
class FakeEl {
  tagName: string;
  attrs: Attrs;
  id = "";
  value = "";
  checked = false;
  disabled = false;
  multiple = false;
  files: { length: number } | null = null;
  options: { textContent: string; value: string }[] = [];
  selectedIndex = 0;
  labels: { textContent: string }[] = [];
  parentElement: FakeEl | null = null;
  previousElementSibling: FakeEl | null = null;
  firstElementChild: FakeEl | null = null;
  textContent = "";
  events: string[] = [];
  clicks = 0;
  constructor(tag: string, attrs: Attrs = {}) {
    this.tagName = tag.toUpperCase();
    this.attrs = attrs;
    this.id = attrs.id ?? "";
  }
  getAttribute(n: string) {
    return n in this.attrs ? this.attrs[n]! : null;
  }
  setAttribute(n: string, v: string) {
    this.attrs[n] = v;
  }
  closest() {
    return null;
  }
  querySelector() {
    return null;
  }
  getClientRects() {
    return [1];
  }
  dispatchEvent(e: FakeEvent) {
    this.events.push(e.type);
    return true;
  }
  click() {
    this.clicks += 1;
    this.checked = !this.checked;
  }
  focus() {}
}

function fakeDoc(els: FakeEl[]) {
  return {
    defaultView: { Event: FakeEvent, atob: (s: string) => Buffer.from(s, "base64").toString("binary") },
    title: "İlan Ver",
    location: { href: "https://www.sahibinden.com/ilan-ver" },
    body: { innerText: "İlanınız yayında. İlan No: 1234567890" },
    documentElement: { outerHTML: "<html></html>" },
    querySelectorAll: (sel: string) => (sel.includes("file") ? els.filter((e) => e.attrs.type === "file") : els.filter((e) => ["INPUT", "SELECT", "TEXTAREA"].includes(e.tagName))),
    querySelector: (sel: string) => {
      const m = /data-emlaksoft-fill="(\d+)"/.exec(sel);
      return m ? (els.find((e) => e.attrs["data-emlaksoft-fill"] === m[1]) ?? null) : null;
    },
    getElementById: () => null,
  } as unknown as Document;
}

const property: PortalPropertyInput = {
  id: "p",
  propertyCode: "ES-1",
  title: "Moda 3+1",
  transactionType: "Satılık",
  propertyType: "Daire",
  listPrice: 6_000_000,
  provinceName: null,
  districtName: "Kadıköy",
  neighborhoodName: null,
  addressLine: null,
  features: { rooms: "3+1", sqm: 120, heating: "Merkezi", description: "Açıklama" },
  parcelBlock: null,
  parcelLot: null,
  swapOk: null,
  eidsPropertyNo: "ABC-123456",
  authorityDocNo: null,
  authorityEidsStatus: null,
  authorizationStart: null,
  authorizationEnd: null,
  deedStatus: null,
  photos: [],
};

describe("sayfa içi işlevler: toplama, uygulama, fotoğraf", () => {
  it("toplar, planlar ve uygular; gizli/parola/telefon denetimlerini atlar; GÖNDERİM yapmaz", () => {
    const title = new FakeEl("input", { type: "text", name: "ilanBasligi" });
    title.labels = [{ textContent: " İlan  Başlığı " }];
    const price = new FakeEl("input", { type: "text", placeholder: "Fiyat" });
    const heat = new FakeEl("select", {});
    heat.labels = [{ textContent: "Isıtma" }];
    heat.options = [
      { textContent: "Seçiniz", value: "" },
      { textContent: "Merkezi", value: "7" },
    ];
    const pass = new FakeEl("input", { type: "password", name: "fiyat" });
    const tel = new FakeEl("input", { type: "tel", name: "telefon" });
    const hidden = new FakeEl("input", { type: "hidden", name: "baslik" });
    const doc = fakeDoc([title, price, heat, pass, tel, hidden]);

    const descs = isolate(collectControlsInPage)(doc);
    expect(descs.map((x) => x.type)).toEqual(["text", "text", ""]);
    expect(descs[0]!.labels).toContain("İlan Başlığı");
    expect(heat.attrs["data-emlaksoft-fill"]).toBe("2");
    expect(pass.attrs["data-emlaksoft-fill"]).toBeUndefined();

    const plan = planFill(descs, buildPortalPayload(property, "sahibinden", 0));
    const res = isolate(applyActionsInPage)(plan.actions, doc);
    expect(res.every((r) => r.ok)).toBe(true);
    expect(title.value).toBe("Moda 3+1");
    expect(price.value).toBe("6000000");
    expect(heat.value).toBe("7");
    expect(title.events).toEqual(["input", "change", "blur"]);
    expect(heat.events).toEqual(["input", "change"]);
    expect(pass.value).toBe("");
    expect(JSON.stringify(plan.actions)).not.toMatch(/submit/i);
  });

  it("bulunamayan denetim başarısız döner (uydurma yok)", () => {
    const res = isolate(applyActionsInPage)([{ idx: 99, op: "text", field: "title", value: "x" }], fakeDoc([]));
    expect(res).toEqual([{ idx: 99, ok: false }]);
  });

  it("fotoğraf: dosya alanı yoksa dürüst neden; var ve DataTransfer reddedilirse 'error' (kullanıcı elle ekler)", () => {
    expect(isolate(attachPhotosInPage)([{ name: "a.jpg", type: "image/jpeg", b64: "AAAA" }], fakeDoc([]))).toEqual({ ok: false, attached: 0, reason: "no_file_input" });
    const file = new FakeEl("input", { type: "file", accept: "image/*" });
    const r = isolate(attachPhotosInPage)([{ name: "a.jpg", type: "image/jpeg", b64: "AAAA" }], fakeDoc([file]));
    expect(r.ok).toBe(false); // sahte pencerede DataTransfer yok → yakalanır, fırlatmaz
  });

  it("ilan no okuma için yalnız adres, başlık ve kısa görünür metin döner", () => {
    const r = isolate(readPageRefInPage)(fakeDoc([]));
    expect(r).toEqual({ url: "https://www.sahibinden.com/ilan-ver", title: "İlan Ver", text: "İlanınız yayında. İlan No: 1234567890" });
    expect(isolate(readListHtmlInPage)(fakeDoc([])).html).toBe("<html></html>");
  });

  it("(0.6.0) betimleyici: zorunlu işareti (required / aria-required / '*') ve BAĞLI etiket kaynakları; komşu metin bağlı sayılmaz", () => {
    const a = new FakeEl("input", { type: "text", name: "fiyat", required: "" });
    const b = new FakeEl("input", { type: "text", "aria-required": "true", placeholder: "Aidat" });
    const c = new FakeEl("input", { type: "text", id: "m2" });
    c.labels = [{ textContent: "m² (Brüt) *" }];
    const e = new FakeEl("input", { type: "text" });
    e.previousElementSibling = Object.assign(new FakeEl("span"), { textContent: "Danışman: Ahmet Yılmaz" });
    const descs = isolate(collectControlsInPage)(fakeDoc([a, b, c, e]));
    expect(descs.map((x) => x.required)).toEqual([true, true, true, false]);
    expect(descs[0]).toMatchObject({ labels: ["fiyat"], sources: ["name"] });
    expect(descs[1]).toMatchObject({ labels: ["Aidat"], sources: ["placeholder"] });
    expect(descs[2]).toMatchObject({ labels: ["m² (Brüt) *", "m2"], sources: ["label_for", "id"] });
    expect(descs[3]!.labels).toContain("Danışman: Ahmet Yılmaz"); // eşleştirmede kullanılır…
    expect(descs[3]!.sources).toEqual([]); // …ama bağlı değil: geri bildirime girmez
  });

  it("(0.6.0) readValuesInPage ham değer döndürmez; kaynağında ağ, gönderim ve olay tetikleme yok", () => {
    const t = new FakeEl("input", { type: "text", "data-emlaksoft-fill": "0" });
    t.value = "Kadıköy Moda 3+1";
    const s = new FakeEl("select", { "data-emlaksoft-fill": "1" });
    s.options = [
      { textContent: "Seçiniz", value: "" },
      { textContent: "Merkezi", value: "7" },
    ];
    s.selectedIndex = 1;
    const out = isolate(readValuesInPage)([0, 1, 5], fakeDoc([t, s]));
    expect(out[0]).toMatchObject({ idx: 0, kind: "text" });
    expect(out[0]!.valueHash).toMatch(/^[0-9a-f]{8}$/);
    expect(out[0]!.digitsHash).toMatch(/^[0-9a-f]{8}$/);
    expect(out[1]).toEqual({ idx: 1, kind: "select", option: "Merkezi" });
    expect(out[2]).toEqual({ idx: 5, kind: "missing" });
    expect(JSON.stringify(out)).not.toMatch(/Kadıköy|Moda/);
    expect(t.events).toEqual([]);
    const fnSrc = readValuesInPage.toString();
    expect(fnSrc).not.toMatch(/fetch\(|XMLHttpRequest|\.submit\(|requestSubmit|dispatchEvent|sendBeacon|\.click\(|\.value\s*=[^=]/);
  });

  it("kaynak sözleşmesi: sayfa içi işlevler gönderim/gezinme/ağ çağrısı içermez", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/lib/portal-transfer/page-fns.ts", "utf8");
    expect(src).not.toMatch(/\.submit\(|requestSubmit|fetch\(|XMLHttpRequest|sendBeacon|location\.(href|assign|replace)\s*=|window\.open|innerHTML\s*=|eval\(|new Function/);
  });
});
