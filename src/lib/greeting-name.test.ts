import { describe, expect, it } from "vitest";
import { greetingNameOf } from "./greeting-name";

describe("greetingNameOf", () => {
  it("ad soyadda ilk adı verir", () => {
    expect(greetingNameOf("Volkan Gezer")).toBe("Volkan");
    expect(greetingNameOf("VOLKAN GEZERTAŞAR")).toBe("VOLKAN");
    expect(greetingNameOf("Ali Veli Can")).toBe("Ali");
  });
  it("unvan biçimli adı bölmez", () => {
    expect(greetingNameOf("Süper admin")).toBe("Süper admin");
    expect(greetingNameOf("Ofis sahibi")).toBe("Ofis sahibi");
    expect(greetingNameOf("Müşteri temsilcisi")).toBe("Müşteri temsilcisi");
  });
  it("boşta undefined", () => {
    expect(greetingNameOf("  ")).toBeUndefined();
    expect(greetingNameOf(null)).toBeUndefined();
  });
});
