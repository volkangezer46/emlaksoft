import type { ControlDescriptor, FillAction } from "./fill-plan";

/**
 * SAYFA İÇİ İŞLEVLER (portal sekmesine `chrome.scripting.executeScript({ func })` ile enjekte edilir).
 *
 * KURAL: her işlev TAMAMEN KENDİ KENDİNE YETER — dış değişken/içe aktarma KULLANMAZ (serileştirilip sayfada çalışır; testte
 * yalıtılmış kapsamda yeniden kurulur). Hepsi KULLANICI TIKLAMASIYLA (popup düğmesi) çalışır; arka planda
 * gezinme/izleme yoktur. Dokunulmayanlar: parola, e-posta, telefon, dosya (fotoğraf işlevi hariç), gizli alan. Gönderim
 * (form submit / "Yayınla") ASLA yapılmaz: kullanıcı kendisi basar.
 */

type Doc = Document;

/** Form denetimlerini betimler ve her birine `data-emlaksoft-fill` sırası damgalar. */
export function collectControlsInPage(doc?: Doc): ControlDescriptor[] {
  const d: Doc = doc ?? document;
  const clean = (s: string | null | undefined): string => (s ?? "").replace(/\s+/g, " ").trim();
  const out: ControlDescriptor[] = [];
  const skip = ["hidden", "submit", "button", "image", "reset", "file", "password", "email", "tel", "search"];
  const els = Array.from(d.querySelectorAll("input, select, textarea")) as (HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement)[];
  let idx = 0;
  for (const el of els) {
    const tag = el.tagName.toLowerCase() as "input" | "select" | "textarea";
    const type = (el.getAttribute("type") ?? "").toLowerCase();
    if (tag === "input" && skip.includes(type)) continue;
    const labels: string[] = [];
    const push = (s: string | null | undefined) => {
      const c = clean(s);
      if (c && c.length <= 80 && !labels.includes(c)) labels.push(c);
    };
    const isChoice = type === "radio" || type === "checkbox";
    let optionText = "";
    const own = el.labels ? Array.from(el.labels as unknown as ArrayLike<Element>) : [];
    if (isChoice) {
      optionText = clean(own[0]?.textContent) || clean(el.getAttribute("value"));
    } else {
      for (const l of own) push(l.textContent);
    }
    push(el.getAttribute("aria-label"));
    const by = el.getAttribute("aria-labelledby");
    if (by) for (const id of by.split(/\s+/)) push(d.getElementById(id)?.textContent);
    if (!isChoice) push(el.getAttribute("placeholder"));
    push(el.getAttribute("name"));
    push(el.id);
    if (isChoice) {
      // Soru etiketi: grup kabı (fieldset/legend, form-group) ya da kabın önceki kardeşi.
      const box = el.closest("fieldset, [role=radiogroup], [role=group], .form-group, .form-row") ?? el.parentElement?.parentElement ?? null;
      push(box?.querySelector("legend")?.textContent);
      push(box?.querySelector("label")?.textContent);
      push(box?.previousElementSibling?.textContent);
    } else {
      push(el.closest("label")?.textContent);
      push(el.previousElementSibling?.textContent);
      push(el.parentElement?.previousElementSibling?.textContent);
      const pt = clean(el.parentElement?.firstElementChild?.textContent);
      if (pt && el.parentElement?.firstElementChild !== el) push(pt);
    }
    const visible = typeof el.getClientRects === "function" ? el.getClientRects().length > 0 : true;
    const options: string[] = [];
    let current = "";
    if (tag === "select") {
      for (const o of Array.from(el.options as unknown as ArrayLike<HTMLOptionElement>)) options.push(clean(o.textContent));
      const sel = el.options?.[el.selectedIndex];
      current = sel ? clean(sel.textContent) : "";
    } else if (!isChoice) {
      current = el.value ?? "";
    }
    el.setAttribute("data-emlaksoft-fill", String(idx));
    out.push({
      idx,
      tag,
      type,
      labels,
      options,
      current,
      checked: Boolean(el.checked),
      group: type === "radio" ? (el.getAttribute("name") ?? "") : "",
      optionText,
      disabled: Boolean(el.disabled) || el.getAttribute("readonly") !== null,
      visible,
    });
    idx += 1;
  }
  return out;
}

/** Planı uygular: React/Vue kontrollü alanlar için yerel `value` ayarlayıcısı + olaylar. Gönderim YOK. */
export function applyActionsInPage(actions: FillAction[], doc?: Doc): { idx: number; ok: boolean }[] {
  const d: Doc = doc ?? document;
  const win = (d.defaultView ?? window) as Window & typeof globalThis;
  const fire = (el: Element, type: string) => el.dispatchEvent(new win.Event(type, { bubbles: true }));
  const results: { idx: number; ok: boolean }[] = [];
  for (const a of actions) {
    const el = d.querySelector(`[data-emlaksoft-fill="${a.idx}"]`) as (HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement) | null;
    if (!el) {
      results.push({ idx: a.idx, ok: false });
      continue;
    }
    try {
      if (a.op === "click") {
        el.click();
      } else if (a.op === "select") {
        const opt = el.options?.[a.optionIndex];
        if (!opt) {
          results.push({ idx: a.idx, ok: false });
          continue;
        }
        const proto = win.HTMLSelectElement?.prototype;
        const setter = proto ? Object.getOwnPropertyDescriptor(proto, "value")?.set : undefined;
        if (setter) setter.call(el, opt.value);
        else el.value = opt.value;
        fire(el, "input");
        fire(el, "change");
      } else {
        const proto = el.tagName.toLowerCase() === "textarea" ? win.HTMLTextAreaElement?.prototype : win.HTMLInputElement?.prototype;
        const setter = proto ? Object.getOwnPropertyDescriptor(proto, "value")?.set : undefined;
        el.focus?.();
        if (setter) setter.call(el, a.value);
        else el.value = a.value;
        fire(el, "input");
        fire(el, "change");
        fire(el, "blur");
      }
      results.push({ idx: a.idx, ok: true });
    } catch {
      results.push({ idx: a.idx, ok: false });
    }
  }
  return results;
}

/** Fotoğrafları (bellekten) dosya alanına `DataTransfer` ile koyar. Başaramazsa dürüst neden döner; kullanıcı elle ekler. */
export function attachPhotosInPage(files: { name: string; type: string; b64: string }[], doc?: Doc): { ok: boolean; attached: number; reason?: string } {
  const d: Doc = doc ?? document;
  const win = (d.defaultView ?? window) as Window & typeof globalThis;
  const inputs = (Array.from(d.querySelectorAll('input[type="file"]')) as HTMLInputElement[]).filter((i) => {
    const accept = (i.getAttribute("accept") ?? "").toLowerCase();
    return !accept || accept.includes("image") || accept.includes("jpg") || accept.includes("jpeg") || accept.includes("png");
  });
  if (inputs.length === 0) return { ok: false, attached: 0, reason: "no_file_input" };
  const input = inputs.find((i) => i.multiple) ?? inputs[0]!;
  try {
    const dt = new win.DataTransfer();
    if (input.multiple && input.files) for (const f of Array.from(input.files)) dt.items.add(f);
    let added = 0;
    for (const f of files) {
      if (!input.multiple && added >= 1) break;
      const bin = win.atob(f.b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      dt.items.add(new win.File([bytes], f.name, { type: f.type }));
      added += 1;
    }
    input.files = dt.files;
    input.dispatchEvent(new win.Event("input", { bubbles: true }));
    input.dispatchEvent(new win.Event("change", { bubbles: true }));
    const got = input.files?.length ?? 0;
    if (got === 0) return { ok: false, attached: 0, reason: "rejected" };
    return { ok: true, attached: added, reason: input.multiple || files.length <= 1 ? undefined : "single_input" };
  } catch {
    return { ok: false, attached: 0, reason: "error" };
  }
}

/** Yayın sonrası ilan numarasını bulmak için sayfa özeti (yalnız adres ve kısa görünür metin). */
export function readPageRefInPage(doc?: Doc): { url: string; title: string; text: string } {
  const d: Doc = doc ?? document;
  return { url: d.location?.href ?? "", title: d.title ?? "", text: (d.body?.innerText ?? "").slice(0, 6000) };
}

/** İlanlarım sayfasının HTML'ini döner (ayrıştırma popup'ta mevcut mağaza ayrıştırıcısıyla yapılır; sayfa değiştirilmez). */
export function readListHtmlInPage(doc?: Doc): { url: string; html: string } {
  const d: Doc = doc ?? document;
  return { url: d.location?.href ?? "", html: (d.documentElement?.outerHTML ?? "").slice(0, 1_500_000) };
}
