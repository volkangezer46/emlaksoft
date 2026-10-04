import { describe, expect, it } from "vitest";
import { DEAL_STAGES, isDealTransitionAllowed, type DealStage } from "@/lib/workflow-state";
import { parseOutcomeParam } from "./[id]/kapanis-model";
import {
  BOARD_COLUMNS,
  BOARD_SCREEN_READER_INSTRUCTIONS,
  adjacentColumn,
  announceDragCancel,
  announceDragEnd,
  announceDragOver,
  announceDragStart,
  canDropOn,
  columnOf,
  resolveBoardDrop,
  resolveStageChange,
  type StageNames,
} from "./board-logic";

const names: StageNames = {
  new: "Yeni",
  qualified: "Nitelikli",
  negotiation: "Müzakere",
  won: "Kazanıldı",
  lost: "Kaybedildi",
};

const deal = (stage: string, id = "d1") => ({ id, stage });
const drop = (stage: string, target: string | number | null | undefined, canEdit = true) =>
  resolveBoardDrop({ canEdit, deal: deal(stage), target });

describe("pano: bırakma hedefinden sonraki eylem", () => {
  it("aynı sütuna bırakma hiçbir şey yapmaz", () => {
    for (const stage of DEAL_STAGES) {
      expect(drop(stage, stage)).toEqual({ kind: "none", reason: "same-column" });
    }
  });

  it("açık aşamaya bırakma updateDealStage eylemi üretir", () => {
    expect(drop("new", "qualified")).toEqual({ kind: "stage", dealId: "d1", from: "new", stage: "qualified" });
    expect(drop("qualified", "negotiation")).toEqual({
      kind: "stage",
      dealId: "d1",
      from: "qualified",
      stage: "negotiation",
    });
  });

  it("Kazanıldı ve Kaybedildi popup yerine Kapanış sekmesine yönlendirir; aşama değişikliği üretmez", () => {
    expect(drop("negotiation", "won")).toEqual({
      kind: "closing",
      dealId: "d1",
      from: "negotiation",
      outcome: "won",
      href: "/app/anlasmalar/d1?sekme=kapanis&sonuc=kazanildi",
    });
    for (const from of ["new", "qualified", "negotiation"] as const) {
      expect(drop(from, "lost")).toEqual({
        kind: "closing",
        dealId: "d1",
        from,
        outcome: "lost",
        href: "/app/anlasmalar/d1?sekme=kapanis&sonuc=kaybedildi",
      });
    }
  });

  it("yönlendirme adresindeki sonuc değeri sihirbazın okuduğu değerle aynıdır", () => {
    for (const [from, outcome] of [["negotiation", "won"], ["new", "lost"]] as const) {
      const action = drop(from, outcome);
      if (action.kind !== "closing") throw new Error("closing bekleniyordu");
      const url = new URL(action.href, "https://ornek.test");
      expect(url.pathname).toBe("/app/anlasmalar/d1");
      expect(url.searchParams.get("sekme")).toBe("kapanis");
      expect(parseOutcomeParam(url.searchParams.get("sonuc"))).toBe(outcome);
    }
  });

  it("kapanmış anlaşmayı geri açma (müzakereye) doğrudan aşama eylemidir", () => {
    expect(drop("won", "negotiation")).toMatchObject({ kind: "stage", stage: "negotiation" });
    expect(drop("lost", "negotiation")).toMatchObject({ kind: "stage", stage: "negotiation" });
  });

  it("izinli olmayan geçiş desteklenmiyor olarak işaretlenir (yönlendirme de üretmez)", () => {
    expect(drop("new", "won")).toEqual({ kind: "unsupported", from: "new", to: "won" });
    expect(drop("qualified", "won")).toEqual({ kind: "unsupported", from: "qualified", to: "won" });
    expect(drop("new", "negotiation")).toEqual({ kind: "unsupported", from: "new", to: "negotiation" });
    expect(drop("won", "lost")).toEqual({ kind: "unsupported", from: "won", to: "lost" });
    expect(drop("lost", "new")).toEqual({ kind: "unsupported", from: "lost", to: "new" });
  });

  it("yetkisiz kullanıcıda hiçbir eylem üretilmez", () => {
    for (const from of DEAL_STAGES) {
      for (const to of DEAL_STAGES) {
        expect(drop(from, to, false)).toEqual({ kind: "none", reason: "forbidden" });
      }
    }
  });

  it("sütun dışına, bilinmeyen hedefe veya kayıp karta bırakma hiçbir şey yapmaz", () => {
    expect(drop("new", null)).toEqual({ kind: "none", reason: "no-target" });
    expect(drop("new", undefined)).toEqual({ kind: "none", reason: "no-target" });
    expect(drop("new", "arsiv")).toEqual({ kind: "none", reason: "no-target" });
    expect(drop("new", 3)).toEqual({ kind: "none", reason: "no-target" });
    expect(resolveBoardDrop({ canEdit: true, deal: null, target: "qualified" })).toEqual({
      kind: "none",
      reason: "no-target",
    });
  });

  it("tanınmayan aşamadaki kart Yeni sütununda durur ve başka sütuna taşınamaz", () => {
    expect(columnOf("eski-asama")).toBe("new");
    expect(drop("eski-asama", "new")).toEqual({ kind: "none", reason: "same-column" });
    expect(drop("eski-asama", "qualified")).toEqual({ kind: "unsupported", from: "new", to: "qualified" });
  });

  it("geçiş kuralı sunucunun tek kaynağıyla (workflow-state) birebir aynıdır", () => {
    for (const from of DEAL_STAGES) {
      for (const to of DEAL_STAGES) {
        const allowed = from !== to && isDealTransitionAllowed(from, to);
        expect(canDropOn(from, to), `${from}→${to}`).toBe(allowed);
        const kind = resolveStageChange(deal(from), to).kind;
        if (from === to) expect(kind).toBe("none");
        else expect(kind === "stage" || kind === "closing", `${from}→${to}`).toBe(allowed);
      }
    }
  });

  it("Kazanıldı/Kaybedildi hedefi hiçbir zaman doğrudan aşama eylemi olmaz", () => {
    for (const from of DEAL_STAGES) {
      for (const to of ["won", "lost"] as const) {
        expect(resolveStageChange(deal(from), to).kind).not.toBe("stage");
      }
    }
  });
});

describe("pano: klavye sütun gezinmesi", () => {
  it("sol/sağ ok komşu sütuna gider, uçta durur", () => {
    expect(BOARD_COLUMNS).toEqual(["new", "qualified", "negotiation", "won", "lost"]);
    expect(adjacentColumn("new", 1)).toBe("qualified");
    expect(adjacentColumn("negotiation", 1)).toBe("won");
    expect(adjacentColumn("won", -1)).toBe("negotiation");
    expect(adjacentColumn("new", -1)).toBeNull();
    expect(adjacentColumn("lost", 1)).toBeNull();
  });
});

describe("pano: Türkçe ekran okuyucu duyuruları", () => {
  it("tutma, taşıma ve iptal duyuruları", () => {
    expect(announceDragStart("Moda 3+1", "new", names)).toBe("Anlaşma Moda 3+1 alındı. Şu an Yeni aşamasında.");
    expect(announceDragEnd("Moda 3+1", drop("new", "qualified"), names)).toBe(
      "Anlaşma Moda 3+1, Nitelikli aşamasına taşındı.",
    );
    expect(announceDragCancel("Moda 3+1", "new", names)).toBe(
      "Taşıma iptal edildi. Anlaşma Moda 3+1, Yeni aşamasında kaldı.",
    );
  });

  it("kapanış sütununa bırakma taşındı demez; sihirbazın açıldığını söyler", () => {
    const text = announceDragEnd("Moda 3+1", drop("negotiation", "won"), names);
    expect(text).toContain("kapanış sihirbazı açılıyor: Kazanıldı");
    expect(text).not.toContain("taşındı");
  });

  it("değişmeyen ve desteklenmeyen bırakmalar", () => {
    expect(announceDragEnd("Moda 3+1", drop("new", "new"), names)).toBe("Anlaşma Moda 3+1 bırakıldı. Aşama değişmedi.");
    expect(announceDragEnd("Moda 3+1", drop("new", null), names)).toBe("Anlaşma Moda 3+1 bırakıldı. Aşama değişmedi.");
    expect(announceDragEnd("Moda 3+1", drop("new", "won"), names)).toBe(
      "Bu taşıma desteklenmiyor. Anlaşma Moda 3+1, Yeni aşamasında kaldı.",
    );
  });

  it("sütun üzerine gelince: ilk raporda susar, sonra hedefin durumunu söyler", () => {
    const over = (from: string, to: DealStage | null, first = false) =>
      announceDragOver({ from, over: to, first, names });
    expect(over("new", "new", true)).toBeUndefined();
    expect(over("new", null, true)).toBeUndefined();
    expect(over("new", "qualified")).toBe("Nitelikli aşamasının üzerinde. Bırakmak için Boşluk veya Enter.");
    expect(over("new", "lost")).toBe("Kaybedildi aşamasının üzerinde. Bırakırsanız kapanış sihirbazı açılır.");
    expect(over("new", "won")).toBe("Kazanıldı aşamasının üzerinde. Bu aşamaya taşınamaz.");
    expect(over("new", "new")).toBe("Yeni aşamasına geri dönüldü. Bırakırsanız aşama değişmez.");
    expect(over("new", null)).toBe("Hiçbir aşama sütununun üzerinde değil.");
  });

  it("duyurular ofisin aşama adlarını kullanır", () => {
    const custom: StageNames = { ...names, qualified: "Sıcak müşteri" };
    expect(announceDragEnd("A", drop("new", "qualified"), custom)).toContain("Sıcak müşteri aşamasına taşındı");
  });

  it("kullanım talimatı klavye tuşlarını ve kapanış davranışını anlatır", () => {
    for (const word of ["Boşluk", "Enter", "ok tuşları", "Escape", "kapanış sihirbazı"]) {
      expect(BOARD_SCREEN_READER_INSTRUCTIONS).toContain(word);
    }
  });
});
