import { describe, expect, it } from "vitest";
import type { ControlDescriptor } from "./fill-plan";
import { anchorIndex, fieldSig, formFingerprint, formShapes, isPersonalControl, sigIndex, signShapes } from "./form-signature";

function d(p: Partial<ControlDescriptor> & { idx: number; labels: string[] }): ControlDescriptor {
  return { tag: "input", type: "text", options: [], current: "", checked: false, group: "", optionText: "", disabled: false, visible: true, sources: p.labels.map(() => "label_for"), ...p };
}

describe("form-signature", () => {
  it("imza = sha256(etiket|tür|sıralı seçenekler); seçenek sırası ve yer tutucu imzayı değiştirmez; çapa ilk 16 hex", async () => {
    const a = await fieldSig({ label: "isitma", control: "choice", options: ["soba", "merkezi"] });
    const b = await fieldSig({ label: "isitma", control: "choice", options: ["merkezi", "soba"] });
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);
    expect(a).not.toBe(await fieldSig({ label: "isitma", control: "text", options: [] }));
    const { shapes } = formShapes([d({ idx: 0, tag: "select", type: "", labels: ["Isıtma"], options: ["Seçiniz", "Soba", "Merkezi"] })]);
    expect(shapes[0]!.options).toEqual(["soba", "merkezi"]);
    const [s] = await signShapes(shapes);
    expect(s!.sig).toBe(a);
    expect(s!.anchor).toBe(a.slice(0, 16));
    expect(anchorIndex([s!]).get(0)).toBe(a.slice(0, 16));
  });

  it("kişisel denetimler (tür ya da etiket — komşu metin dahil) ve görünmez/gizli denetimler şemaya girmez", () => {
    const descs = [
      d({ idx: 0, labels: ["Fiyat"] }),
      d({ idx: 1, type: "tel", labels: ["Numara"] }),
      d({ idx: 2, labels: ["Cep Telefonu"] }),
      d({ idx: 3, labels: ["adSoyad"], sources: ["name"] }),
      d({ idx: 4, labels: ["Not", "Danışman: Ahmet Yılmaz"], sources: ["label_for"] }),
      d({ idx: 5, labels: ["Mağaza adı"] }),
      d({ idx: 6, labels: ["E-posta"] }),
      d({ idx: 7, labels: ["Gizli"], visible: false }),
      d({ idx: 8, type: "hidden", labels: ["x"] }),
    ];
    const { shapes, personal } = formShapes(descs);
    expect(shapes.map((s) => s.idxs[0])).toEqual([0]);
    expect(personal).toBeGreaterThanOrEqual(6);
    expect(isPersonalControl({ type: "text", labels: ["İletişim bilgileri"] })).toBe(true);
    expect(isPersonalControl({ type: "text", labels: ["Bulunduğu kat"] })).toBe(false);
  });

  it("etiket yalnız BAĞLI kaynaktan; komşu metin kullanılmaz; radyo grubu tek soru", () => {
    const { shapes } = formShapes([
      d({ idx: 0, labels: ["fiyatInput", "Son fiyat güncellemesi 12 Ekim"], sources: ["name"] }),
      d({ idx: 1, type: "radio", group: "site", optionText: "Evet", labels: ["siteIc", "Site İçerisinde"], sources: ["name", "legend"] }),
      d({ idx: 2, type: "radio", group: "site", optionText: "Hayır", labels: ["siteIc", "Site İçerisinde"], sources: ["name", "legend"] }),
      d({ idx: 3, labels: ["Komşu metin"], sources: [] }),
    ]);
    expect(shapes[0]).toMatchObject({ label: "fiyat input", labelSource: "name", control: "text" });
    expect(shapes[1]).toMatchObject({ idxs: [1, 2], label: "site icerisinde", labelSource: "legend", control: "choice", options: ["evet", "hayir"] });
    expect(shapes[2]).toMatchObject({ label: "" }); // bağlı etiket yok → boş (yük süzgecinde düşer)
  });

  it("parmak izi: sıralı benzersiz 'etiket|tür' kümesi (sıra ve tekrar değiştirmez)", async () => {
    const a = await formFingerprint([{ label: "fiyat", control: "number" }, { label: "baslik", control: "text" }]);
    const b = await formFingerprint([{ label: "baslik", control: "text" }, { label: "fiyat", control: "number" }, { label: "fiyat", control: "number" }]);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    const signed = await signShapes(formShapes([d({ idx: 4, type: "radio", group: "g", optionText: "Var", labels: ["Balkon"] }), d({ idx: 5, type: "radio", group: "g", optionText: "Yok", labels: ["Balkon"] })]).shapes);
    expect(sigIndex(signed).get(5)?.sig).toBe(sigIndex(signed).get(4)?.sig);
  });
});
