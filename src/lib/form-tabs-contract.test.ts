import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CUSTOMER_DRAFT_FIELDS, CUSTOMER_TABS } from "@/app/app/musteriler/yeni/customer-tabs";
import { PROPERTY_DRAFT_FIELDS, PROPERTY_TABS } from "@/app/app/portfoyler/yeni/property-tabs";
import { APPROVAL_DRAFT_FIELDS, APPROVAL_TABS } from "@/app/app/onaylar/yeni/approval-tabs";
import { CAMPAIGN_DRAFT_FIELDS, CAMPAIGN_TABS } from "@/app/app/kampanyalar/yeni/campaign-tabs";
import { PROJECT_DRAFT_FIELDS, PROJECT_TABS } from "@/app/app/projeler/yeni/project-tabs";
import { TICKET_DRAFT_FIELDS, TICKET_TABS } from "@/app/app/destek/yeni/ticket-tabs";
import { DEMAND_DRAFT_FIELDS, DEMAND_TABS } from "@/app/app/talepler/yeni/demand-tabs";
import { DEAL_DRAFT_FIELDS, DEAL_TABS } from "@/app/app/anlasmalar/yeni/deal-tabs";
import { OFFER_DRAFT_FIELDS, OFFER_TABS } from "@/app/app/teklifler/yeni/offer-tabs";
import { CONTRACT_DRAFT_FIELDS, CONTRACT_TABS } from "@/app/app/sozlesmeler/yeni/contract-tabs";
import { APPOINTMENT_DRAFT_FIELDS, APPOINTMENT_TABS } from "@/app/app/randevular/yeni/appointment-tabs";
import { TASK_DRAFT_FIELDS, TASK_TABS } from "@/app/app/gorevler/yeni/task-tabs";
import { RENTAL_DRAFT_FIELDS, RENTAL_TABS } from "@/app/app/kiralama/yeni/rental-tabs";
import { OPEN_HOUSE_DRAFT_FIELDS, OPEN_HOUSE_TABS } from "@/app/app/acik-ev/yeni/open-house-tabs";
import { PRESENTATION_DRAFT_FIELDS, PRESENTATION_TABS } from "@/app/app/portfoyler/sunumlar/yeni/presentation-tabs";
import { isSensitiveFieldName } from "./form-tabs";
import { TAB_ICONS } from "./icons";

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
  for (const m of src.matchAll(/\bname="([A-Za-z_]+)"/g)) names.add(m[1]);
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
    name: "proje",
    source: "src/app/app/projeler/yeni/new-project-form.tsx",
    tabs: PROJECT_TABS as readonly TabLike[],
    draft: PROJECT_DRAFT_FIELDS as readonly string[],
  },
  {
    name: "kampanya",
    source: "src/app/app/kampanyalar/yeni/new-campaign-form.tsx",
    tabs: CAMPAIGN_TABS as readonly TabLike[],
    draft: CAMPAIGN_DRAFT_FIELDS as readonly string[],
  },
  {
    name: "onay",
    source: "src/app/app/onaylar/yeni/new-approval-form.tsx",
    tabs: APPROVAL_TABS as readonly TabLike[],
    draft: APPROVAL_DRAFT_FIELDS as readonly string[],
  },
  {
    name: "destek",
    source: "src/app/app/destek/yeni/new-ticket-form.tsx",
    tabs: TICKET_TABS as readonly TabLike[],
    draft: TICKET_DRAFT_FIELDS as readonly string[],
  },
  {
    name: "talep",
    source: "src/app/app/talepler/yeni/demand-form.tsx",
    tabs: DEMAND_TABS as readonly TabLike[],
    draft: DEMAND_DRAFT_FIELDS as readonly string[],
  },
  {
    name: "anlaşma",
    source: "src/app/app/anlasmalar/yeni/new-deal-form.tsx",
    tabs: DEAL_TABS as readonly TabLike[],
    draft: DEAL_DRAFT_FIELDS as readonly string[],
  },
  {
    name: "teklif",
    source: "src/app/app/teklifler/yeni/new-offer-form.tsx",
    tabs: OFFER_TABS as readonly TabLike[],
    draft: OFFER_DRAFT_FIELDS as readonly string[],
  },
  {
    name: "sözleşme",
    source: "src/app/app/sozlesmeler/yeni/new-contract-form.tsx",
    tabs: CONTRACT_TABS as readonly TabLike[],
    draft: CONTRACT_DRAFT_FIELDS as readonly string[],
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

describe("sekme ikonları (ortak sözlük)", () => {
  it("her form ikonları src/lib/icons.ts TAB_ICONS sözlüğünden alır; formda çakışma yok; her sekmenin ikonu var", () => {
    for (const form of FORMS) {
      const src = read(form.source);
      const block = /const TAB_ICONS = \{([\s\S]*?)\} as const;/.exec(src)?.[1] ?? "";
      const used = [...block.matchAll(/TI\.([A-Za-z]+)/g)].map((m) => m[1]);
      expect(used.length, `${form.name}: TAB_ICONS`).toBe(form.tabs.length);
      expect(new Set(used).size, `${form.name}: aynı formda tekrar eden ikon`).toBe(used.length);
      for (const key of used) expect(Object.keys(TAB_ICONS), `${form.name}: ${key}`).toContain(key);
    }
  });
  it("sözlükte iki kavram aynı ikonu paylaşmaz (bilinçli eş anlamlılar hariç)", () => {
    const allowedShared = new Set(["ozellikler|gorev"]);
    const names = Object.keys(TAB_ICONS) as (keyof typeof TAB_ICONS)[];
    for (let i = 0; i < names.length; i += 1) {
      for (let j = i + 1; j < names.length; j += 1) {
        if (TAB_ICONS[names[i]] !== TAB_ICONS[names[j]]) continue;
        expect(allowedShared.has(`${names[i]}|${names[j]}`), `${names[i]} = ${names[j]}`).toBe(true);
      }
    }
  });
});

describe("kabuk kaynağı sözleşmesi", () => {
  const shell = read("src/components/ui/tabbed-form-shell.tsx");
  it("WAI-ARIA sekme öznitelikleri", () => {
    // Sekme düğmeleri MorphTabs'ta (tek sekme sistemi); paneller kabukta.
    const morph = read("src/components/ui/morph-tabs.tsx");
    for (const s of ['role="tablist"', 'role="tab"', "aria-selected", "aria-controls", "aria-orientation", "tabIndex={active ? 0 : -1}"]) {
      expect(morph).toContain(s);
    }
    expect(shell).toContain("<MorphTabs");
    expect(shell).not.toContain('role="tab"');
    expect(shell).toContain("aria-labelledby");
    expect(shell).toContain('role={tabbed ? "tabpanel" : undefined}');
  });
  it("MorphTabs: Date.now / new Date yok", () => {
    for (const f of ["morph-tabs.tsx", "morph-tab-parts.tsx", "use-persisted-flag.ts"]) {
      expect(read(`src/components/ui/${f}`)).not.toMatch(/Date\.now\(|new Date\(/);
    }
  });
  it("paneller DOM'da kalır (hidden), tek <form>", () => {
    expect(shell).toContain("hidden={!selected}");
    expect(shell.match(/<form ref=/g)?.length).toBe(1);
  });
  it("Date.now / new Date yok", () => {
    expect(shell).not.toMatch(/Date\.now\(|new Date\(/);
  });
});
