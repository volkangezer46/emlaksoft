import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AvatarArt } from "./avatar-art";
import { Avatar } from "./avatar";

/*
 * Aynı hazır avatar sayfada iki kez basılınca (Ekip: masaüstü tablo + gizli mobil kart) `<linearGradient id>` çakışır;
 * `url(#id)` display:none içindeki ilk kopyaya çözülür ve Chrome zemini boyamaz → beyaz zeminde görünmez avatar.
 * Zemin CSS arka planıdır: işaretlemede id ya da url(#…) başvurusu olmamalı.
 */
describe("AvatarArt", () => {
  it("SVG id / url(#) başvurusu taşımaz; zemin CSS geçişiyle çizilir", () => {
    const html = renderToStaticMarkup(h(AvatarArt, { preset: "anahtar" }));
    expect(html).not.toMatch(/\sid=/);
    expect(html).not.toContain("url(#");
    expect(html).toContain("linear-gradient(135deg");
  });

  it("iki kopya yan yana aynı (çakışacak kimlik yok) ve Avatar hazır seçimde AvatarArt basar", () => {
    const one = renderToStaticMarkup(h(Avatar, { name: "Danışman", preset: "pusula" }));
    expect(one).toContain("linear-gradient(135deg");
    expect(one).not.toMatch(/\sid=/);
  });
});
