import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Combobox } from "./combobox";

/**
 * Combobox sözleşmesi. Projede jsdom/Testing Library yok (vitest ortamı "node", yeni bağımlılık eklenmez; bkz.
 * chart-ui.test.ts): bileşen react-dom/server ile çizilir, gönderim/sıfırlama davranışı kaynaktaki sözleşmeyle korunur.
 * Gerçek tarayıcı doğrulaması (form submit engeli) oturumlu E2E kapsamındadır.
 */
const options = [
  { value: "a", label: "Ali" },
  { value: "b", label: "Burak" },
];
const render = (props: Record<string, unknown>) => renderToStaticMarkup(h(Combobox, { options, ...props }));
const src = readFileSync(join(process.cwd(), "src/components/ui/combobox.tsx"), "utf8");

describe("Combobox: zorunlu alan", () => {
  it("required + name: doğrulanabilir metin girişi (hidden değil), boş değerle, tek name", () => {
    const html = render({ name: "owner", required: true });
    const input = html.match(/<input[^>]*name="owner"[^>]*>/g) ?? [];
    expect(input).toHaveLength(1);
    expect(input[0]).toContain('type="text"');
    expect(input[0]).toContain("required");
    expect(input[0]).toContain('tabindex="-1"');
    expect(input[0]).toContain('aria-hidden="true"');
    expect(input[0]).toContain('value=""');
    expect(input[0]).not.toMatch(/readonly/i);
    expect(input[0]).not.toContain('type="hidden"');
  });

  it("required değilken eski davranış: tek hidden giriş", () => {
    const input = render({ name: "owner" }).match(/<input[^>]*name="owner"[^>]*>/g) ?? [];
    expect(input).toHaveLength(1);
    expect(input[0]).toContain('type="hidden"');
    expect(input[0]).not.toContain("required");
  });

  it("seçimden sonra (defaultValue) giriş değeri taşır; form o değeri gönderir", () => {
    const input = render({ name: "owner", required: true, defaultValue: "b" }).match(/<input[^>]*name="owner"[^>]*>/g) ?? [];
    expect(input[0]).toContain('value="b"');
  });

  it("boşken Türkçe özel mesaj, geçersizde tetikleyiciye odak ve form sıfırlamada varsayılana dönüş kaynakta durur", () => {
    expect(src).toContain('setCustomValidity(validated && !value ? "Lütfen bir seçim yapın" : "")');
    expect(src).toMatch(/onInvalid=\{\(\) => \{[\s\S]*triggerRef\.current\?\.focus\(\)/);
    expect(src).toMatch(/addEventListener\("reset", onReset\)/);
    expect(src).toContain("setUncontrolled(defaultValue)");
  });

  it("devre dışı zorunlu alan formu kilitlemez (hidden giriş)", () => {
    const input = render({ name: "owner", required: true, disabled: true }).match(/<input[^>]*name="owner"[^>]*>/g) ?? [];
    expect(input[0]).toContain('type="hidden"');
  });
});

describe("Combobox: selectedLabel", () => {
  it("defaultValue havuzda yoksa tetikleyici selectedLabel gösterir", () => {
    const html = render({ name: "p", defaultValue: "zzz", selectedLabel: "Kadıköy Daire 3+1", placeholder: "Seçiniz" });
    expect(html).toContain("Kadıköy Daire 3+1");
    expect(html).not.toContain(">Seçiniz<");
  });

  it("havuzdaki değerde havuz etiketi kazanır; değer boşsa yer tutucu görünür", () => {
    expect(render({ defaultValue: "a", selectedLabel: "Eski ad" })).toContain("Ali");
    expect(render({ defaultValue: "", selectedLabel: "Eski ad", placeholder: "Seçiniz" })).toContain("Seçiniz");
  });

  it("mount'ta sunucu araması yapılmaz: arama yalnız kullanıcı yazınca çalışır", () => {
    expect(src).toMatch(/if \(q\.length < minSearchLength\) return;/);
  });
});
