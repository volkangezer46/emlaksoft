import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Sözleşme: `useFormDirty` kirli denetimini olayın İÇİNDE eşzamanlı yapmaz.
 *
 * Hata (Muhasebe > Yeni kayıt, canlıda tutar alanına hiçbir şey yazılamıyordu): form üzerindeki yerel "input"/"keyup"
 * dinleyicisi React'in kök dinleyicisinden ÖNCE çalışıp setDirty çağırıyordu. React aynı olayı işlemeden önce bekleyen
 * güncellemeyi boşaltıyor, yeniden çizim KONTROLLÜ alanın eski değerini ("") DOM'a geri yazıyor ve onChange hiç
 * tetiklenmiyordu; keyup ↔ input her tuşta kirli durumunu çevirdiği için döngü her tuşta tekrar ediyordu. Gerçek tarayıcıda
 * (Playwright) yeniden üretildi; bu depoda DOM test ortamı (jsdom) olmadığından kural kaynakta kilitlenir.
 */
const SRC = readFileSync(path.resolve(import.meta.dirname, "form-action-bar.tsx"), "utf8");

function hookBody(): string {
  const start = SRC.indexOf("export function useFormDirty(");
  expect(start).toBeGreaterThan(-1);
  const end = SRC.indexOf("\nexport ", start + 10);
  return SRC.slice(start, end === -1 ? undefined : end);
}

describe("useFormDirty: denetim olaydan sonra", () => {
  it("dinleyici setDirty'yi zamanlayıcı içinde çağırır (olay içinde eşzamanlı değil)", () => {
    const body = hookBody();
    const check = body.slice(body.indexOf("const check = "), body.indexOf("const events = "));
    expect(check).toMatch(/setTimeout\(/);
    // setDirty yalnız zamanlayıcının gövdesinde geçer.
    const beforeTimer = check.slice(0, check.indexOf("setTimeout("));
    expect(beforeTimer).not.toMatch(/setDirty\(/);
  });

  it("temizlikte bekleyen zamanlayıcı iptal edilir", () => {
    expect(hookBody()).toMatch(/clearTimeout\(timer\)/);
  });
});
