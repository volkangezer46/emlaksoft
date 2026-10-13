import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createViewportGate } from "./viewport-gate";

/** Sahte IntersectionObserver: test elle "görünür" tetikler; bağlantısı kesilen gözlemci bir daha tetiklenmez. */
type FakeIo = { el: Element | null; cb: (e: { isIntersecting: boolean }[]) => void; live: boolean };
let observers: FakeIo[] = [];

beforeEach(() => {
  observers = [];
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
