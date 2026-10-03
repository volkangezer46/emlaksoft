import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CUSTOMER_DRAFT_FIELDS, CUSTOMER_TABS } from "@/app/app/musteriler/yeni/customer-tabs";
import { PROPERTY_DRAFT_FIELDS, PROPERTY_TABS } from "@/app/app/portfoyler/yeni/property-tabs";
import { APPOINTMENT_DRAFT_FIELDS, APPOINTMENT_TABS } from "@/app/app/randevular/yeni/appointment-tabs";
import { TASK_DRAFT_FIELDS, TASK_TABS } from "@/app/app/gorevler/yeni/task-tabs";
import { RENTAL_DRAFT_FIELDS, RENTAL_TABS } from "@/app/app/kiralama/yeni/rental-tabs";
import { OPEN_HOUSE_DRAFT_FIELDS, OPEN_HOUSE_TABS } from "@/app/app/acik-ev/yeni/open-house-tabs";
import { PRESENTATION_DRAFT_FIELDS, PRESENTATION_TABS } from "@/app/app/portfoyler/sunumlar/yeni/presentation-tabs";
import { isSensitiveFieldName } from "./form-tabs";

/**
 * Sözleşme: sekmelerde tanımlı alan listelerinin birleşimi, form kaynağındaki
 * `name="..."` kümesine (+ bilinen bileşenlerin ürettiği alanlar) EŞİT olmalı.
 * Yetim alan (sekmesiz) ya da hayalet alan (formda olmayan) kalamaz; zorunlu alanlar
 * sekmenin fields alt kümesi olmalı; sekme sayısı 2-5; id'ler benzersiz.
 */

const root = path.resolve(import.meta.dirname, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

/** Kaynaktaki `name="x"` + özel bileşenlerin sabit alanları (GeoSelect, LatLngPicker). */
function namesInSource(src: string): Set<string> {
  const names = new Set<string>();
  for (const m of src.matchAll(/\bname="([a-z_]+)"/g)) names.add(m[1]);
  if (/<GeoSelect\b/.test(src)) {
    names.add("province_id");
    names.add("district_id");
    if (!/withNeighborhood=\{false\}/.test(src)) names.add("neighborhood_id");
  }
  if (/<LatLngPicker\b/.test(src)) {
    names.add("lat");
    names.add("lng");
  }
  return names;
}

type TabLike = { id: string; fields: readonly string[]; required: readonly string[] };

const FORMS = [
  {
    name: "müşteri",
    source: "src/app/app/musteriler/yeni/customer-form.tsx",
    tabs: CUSTOMER_TABS as readonly TabLike[],
    draft: CUSTOMER_DRAFT_FIELDS as readonly string[],
  },
  {
    name: "portföy",
    source: "src/app/app/portfoyler/yeni/property-form.tsx",
    tabs: PROPERTY_TABS as readonly TabLike[],
    draft: PROPERTY_DRAFT_FIELDS as readonly string[],
  },
  {
    name: "randevu",
    source: "src/app/app/randevular/yeni/appointment-form.tsx",
    tabs: APPOINTMENT_TABS as readonly TabLike[],
    draft: APPOINTMENT_DRAFT_FIELDS as readonly string[],
  },
  {
    name: "görev",
    source: "src/app/app/gorevler/yeni/task-form.tsx",
    tabs: TASK_TABS as readonly TabLike[],
    draft: TASK_DRAFT_FIELDS as readonly string[],
  },
  {
    name: "kira kaydı",
    source: "src/app/app/kiralama/yeni/rental-form.tsx",
    tabs: RENTAL_TABS as readonly TabLike[],
    draft: RENTAL_DRAFT_FIELDS as readonly string[],
  },
  {
    name: "açık ev",
    source: "src/app/app/acik-ev/yeni/open-house-form.tsx",
    tabs: OPEN_HOUSE_TABS as readonly TabLike[],
    draft: OPEN_HOUSE_DRAFT_FIELDS as readonly string[],
  },
  {
    name: "sunum",
    source: "src/app/app/portfoyler/sunumlar/yeni/presentation-form.tsx",
    tabs: PRESENTATION_TABS as readonly TabLike[],
    draft: PRESENTATION_DRAFT_FIELDS as readonly string[],
  },
];

describe.each(FORMS)("sekme sözleşmesi: $name formu", ({ source, tabs, draft }) => {
  const src = read(source);
  const declared = tabs.flatMap((t) => t.fields);

  it("sekme sayısı 2-5, id'ler benzersiz", () => {
    expect(tabs.length).toBeGreaterThanOrEqual(2);
    expect(tabs.length).toBeLessThanOrEqual(5);
    expect(new Set(tabs.map((t) => t.id)).size).toBe(tabs.length);
  });

  it("bir alan yalnız tek sekmede", () => {
    expect(new Set(declared).size).toBe(declared.length);
  });

  it("sekme alanları = form kaynağındaki name= kümesi (yetim/hayalet alan yok)", () => {
    const inSource = namesInSource(src);
    expect([...inSource].filter((n) => !declared.includes(n)).sort()).toEqual([]);
    expect(declared.filter((n) => !inSource.has(n)).sort()).toEqual([]);
  });

  it("zorunlu alanlar sekmenin alan alt kümesi ve kaynakta required", () => {
    for (const t of tabs) {
      for (const r of t.required) {
        expect(t.fields, `${t.id}: ${r}`).toContain(r);
      }
    }
  });

  it("her tabPanels anahtarı bir sekmeye karşılık gelir", () => {
    for (const t of tabs) {
      const key = /^[a-z]+$/.test(t.id) ? `${t.id}:` : `"${t.id}":`;
      expect(src, `panel: ${t.id}`).toContain(key);
    }
  });

  it("taslak beyaz listesi: alanlar tanımlı ve hassas değil", () => {
    for (const f of draft) {
      expect(declared, f).toContain(f);
      expect(isSensitiveFieldName(f), f).toBe(false);
    }
  });
});

describe("kabuk kaynağı sözleşmesi", () => {
  const shell = read("src/components/ui/tabbed-form-shell.tsx");
  it("WAI-ARIA sekme öznitelikleri", () => {
    for (const s of ['role="tablist"', 'role="tab"', 'aria-selected', 'aria-controls', 'aria-labelledby', "aria-orientation", "tabIndex={selected ? 0 : -1}"]) {
      expect(shell).toContain(s);
    }
    expect(shell).toContain('role={tabbed ? "tabpanel" : undefined}');
  });
  it("paneller DOM'da kalır (hidden), tek <form>", () => {
    expect(shell).toContain("hidden={!selected}");
    expect(shell.match(/<form ref=/g)?.length).toBe(1);
  });
  it("Date.now / new Date yok", () => {
    expect(shell).not.toMatch(/Date\.now\(|new Date\(/);
  });
});
