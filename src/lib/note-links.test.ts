import { describe, expect, it } from "vitest";
import { noteLink, splitNoteLinks } from "./note-links";

const links = (text: string) => splitNoteLinks(text).filter((p) => p.kind === "link");
const plain = (text: string) => splitNoteLinks(text).map((p) => (p.kind === "text" ? p.text : `<${p.label}>`)).join("");

describe("not bağlantıları — köşeli parantezli etiketler", () => {
  it("noteLink köşeli parantezi kaçışlar; ayrıştırıcı etiketi kayıpsız geri okur", () => {
    const label = "Daire [3+1] Kadıköy]";
    const text = `Bakın: ${noteLink(label, "/app/portfoyler/abc")} sonra arayın.`;
    expect(links(text)).toEqual([{ kind: "link", label, href: "/app/portfoyler/abc" }]);
    expect(plain(text)).toBe(`Bakın: <${label}> sonra arayın.`);
  });

  it("ters eğik çizgi ve açılış köşeli parantezi de gidiş-dönüşte korunur", () => {
    for (const label of ["A\\B", "[başta", "sonda[", "\\]", "x]]y[[z"]) {
      expect(links(noteLink(label, "/app/gorevler?gorev=1"))).toEqual([{ kind: "link", label, href: "/app/gorevler?gorev=1" }]);
    }
  });

  it("elle yazılmış tek düzey dengeli parantez (kaçışsız) etiketin parçası sayılır", () => {
    expect(links("[Daire [3+1]](/app/portfoyler/1)")).toEqual([{ kind: "link", label: "Daire [3+1]", href: "/app/portfoyler/1" }]);
  });

  it("bağlantı olmayan köşeli parantez metni bozmaz; sonraki bağlantı doğru yakalanır", () => {
    const text = "[not] ve [Aç](/app/musteriler/9)";
    expect(links(text)).toEqual([{ kind: "link", label: "Aç", href: "/app/musteriler/9" }]);
    expect(plain(text)).toBe("[not] ve <Aç>");
  });

  it("yoldaki ')' ve boşluk kodlanır; etiketteki satır sonu boşluğa çevrilir", () => {
    const text = noteLink("iki\nsatır", "/app/raporlar?q=a b)");
    expect(text).toBe("[iki satır](/app/raporlar?q=a%20b%29)");
    expect(links(text)).toEqual([{ kind: "link", label: "iki satır", href: "/app/raporlar?q=a%20b%29" }]);
  });

  it("eski biçimler: kaçışsız etiket ve çıplak yol çalışmaya devam eder", () => {
    expect(links("[İlan kontrolünde aç](/app/ilan-kontrol) ve /app/gorevler?gorev=1.")).toEqual([
      { kind: "link", label: "İlan kontrolünde aç", href: "/app/ilan-kontrol" },
      { kind: "link", label: "Aç", href: "/app/gorevler?gorev=1" },
    ]);
  });

  it("uzun köşeli parantez dizisinde doğrusal kalır (geri izleme patlaması yok)", () => {
    const evil = "[" + "[a]".repeat(5000) + "x";
    const t0 = performance.now();
    splitNoteLinks(evil);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});
