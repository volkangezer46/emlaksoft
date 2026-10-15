import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { INTENT_EVENTS, __resetViewportIntentForTests, createViewportGate, sameIslandProps } from "./viewport-gate";

/** Sahte IntersectionObserver: test elle "görünür" tetikler; bağlantısı kesilen gözlemci bir daha tetiklenmez. */
type FakeIo = { el: Element | null; cb: (e: { isIntersecting: boolean }[]) => void; live: boolean };
let observers: FakeIo[] = [];

/** Sahte belge: yalnız capture dinleyicilerini tutar; `fire` gerçek olay sırası gibi dinleyicileri çağırır. */
type Listener = { type: string; fn: () => void; once: boolean };
let listeners: Listener[] = [];
const fakeDocument = {
  readyState: "complete",
  addEventListener(type: string, fn: () => void, opts?: { once?: boolean }) {
    listeners.push({ type, fn, once: Boolean(opts?.once) });
  },
  removeEventListener(type: string, fn: () => void) {
    listeners = listeners.filter((l) => !(l.type === type && l.fn === fn));
  },
};
const fire = (type: string) => {
  for (const l of listeners.filter((x) => x.type === type)) {
    if (l.once) listeners = listeners.filter((x) => x !== l);
    l.fn();
  }
};

beforeEach(() => {
  observers = [];
  listeners = [];
  __resetViewportIntentForTests();
  vi.stubGlobal("window", {});
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      private o: FakeIo;
      constructor(cb: FakeIo["cb"]) {
        this.o = { el: null, cb, live: true };
        observers.push(this.o);
      }
      observe(el: Element) {
        this.o.el = el;
      }
      disconnect() {
        this.o.live = false;
      }
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

const intersect = (el: Element) => {
  for (const o of observers) if (o.live && o.el === el) o.cb([{ isIntersecting: true }]);
};
const settled = async (p: Promise<void>) => {
  let done = false;
  void p.then(() => (done = true));
  await new Promise((r) => setTimeout(r, 0));
  return done;
};

describe("vitrin ada kapısı (örnek başına gözlem)", () => {
  it("görünür alana yaklaşmadan açılmaz, yaklaşınca açılır", async () => {
    const gate = createViewportGate();
    const el = {} as Element;
    gate.watch(el);
    expect(await settled(gate.released)).toBe(false);
    intersect(el);
    expect(await settled(gate.released)).toBe(true);
  });

  it("istemci gezinmesi: eski eleman sökülse de yeni sayfanın elemanı kapıyı açar (form askıda kalmaz)", async () => {
    const gate = createViewportGate();
    const vitrinForm = {} as Element;
    const stopOld = gate.watch(vitrinForm); // vitrin: form 60 kartın altında, görünmüyor
    stopOld(); // ilan kartına tıklandı → vitrin sökülür
    intersect(vitrinForm); // eski gözlemci kopuk; tetiklenmez
    expect(await settled(gate.released)).toBe(false);
    const detailForm = {} as Element;
    gate.watch(detailForm); // ilan detayı aynı adayı yeniden bağlar
    intersect(detailForm);
    expect(await settled(gate.released)).toBe(true);
  });

  it("açıldıktan sonra yeni örnekler gözlemci kurmaz", () => {
    const gate = createViewportGate();
    const el = {} as Element;
    gate.watch(el);
    intersect(el);
    const before = observers.length;
    gate.watch({} as Element);
    expect(observers.length).toBe(before);
  });

  it("eleman ya da IntersectionObserver yoksa hemen açılır", async () => {
    const a = createViewportGate();
    a.watch(null);
    expect(await settled(a.released)).toBe(true);
    vi.stubGlobal("IntersectionObserver", undefined);
    const b = createViewportGate();
    b.watch({} as Element);
    expect(await settled(b.released)).toBe(true);
  });

  it("sunucuda (window yok) kapı baştan açıktır (SSR tam HTML basar)", async () => {
    vi.stubGlobal("window", undefined);
    expect(await settled(createViewportGate().released)).toBe(true);
  });
});

describe("kullanıcı niyeti (SK8 B146: kaydırmadan çip tıklaması)", () => {
  it("pointerdown kapıyı açar — görünür alana hiç yaklaşılmadan, TÜM adalar için", async () => {
    vi.stubGlobal("document", fakeDocument);
    const talep = createViewportGate();
    const arama = createViewportGate();
    talep.watch({} as Element); // form 6.700 px aşağıda: gözlemci tetiklenmez
    arama.watch({} as Element);
    expect(await settled(talep.released)).toBe(false);
    fire("pointerdown"); // "Satılık" çipine dokunuş (click'ten ÖNCE)
    expect(await settled(talep.released)).toBe(true);
    expect(await settled(arama.released)).toBe(true);
    // Dinleyiciler tek seferlik ve temizlenmiş: belge üzerinde kalıntı yok.
    expect(listeners).toEqual([]);
  });

  it.each(INTENT_EVENTS)("%s olayı da kapıyı açar", async (type) => {
    vi.stubGlobal("document", fakeDocument);
    const gate = createViewportGate();
    fire(type);
    expect(await settled(gate.released)).toBe(true);
  });

  it("niyetten SONRA kurulan kapı baştan açıktır (istemci gezinmesiyle gelen yeni ada beklemez)", async () => {
    vi.stubGlobal("document", fakeDocument);
    createViewportGate();
    fire("keydown");
    expect(await settled(createViewportGate().released)).toBe(true);
  });

  it("niyet yokken dinleyiciler capture + passive kurulur, görünürlükle açılınca da kapı tekrar açılmaz", async () => {
    const add = vi.fn(fakeDocument.addEventListener);
    vi.stubGlobal("document", { ...fakeDocument, addEventListener: add });
    const gate = createViewportGate();
    expect(add.mock.calls.map((c) => c[0]).sort()).toEqual([...INTENT_EVENTS].sort());
    for (const c of add.mock.calls) expect(c[2]).toMatchObject({ capture: true, passive: true, once: true });
    const el = {} as Element;
    gate.watch(el);
    intersect(el);
    expect(await settled(gate.released)).toBe(true);
  });
});

describe("ada prop eşitliği (memo — hidrasyonu bekleyen sınıra güncelleme gitmez)", () => {
  it("RSC'den yeni nesne olarak gelen AYNI veri eşittir", () => {
    const a = { token: "t", provinces: [{ id: "1", name: "İstanbul" }], vitrinSlug: "demo-ofis" };
    const b = { token: "t", provinces: [{ id: "1", name: "İstanbul" }], vitrinSlug: "demo-ofis" };
    expect(sameIslandProps(a, b)).toBe(true);
  });

  it("değişen veri, eksik/fazla anahtar ve React öğesi (children) eşit sayılmaz", () => {
    expect(sameIslandProps({ token: "a" }, { token: "b" })).toBe(false);
    expect(sameIslandProps({ token: "a" }, { token: "a", x: 1 })).toBe(false);
    const el = (k: string) => ({ $$typeof: Symbol.for("react.transitional.element"), key: k, props: {} });
    expect(sameIslandProps({ children: el("1") }, { children: el("1") })).toBe(false);
  });
});
