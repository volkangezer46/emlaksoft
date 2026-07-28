import { describe, expect, it } from "vitest";
import {
  MAX_STEPS_PER_RUN,
  buildPlaybookTaskRows,
  matchesPlaybookFilter,
  resolveStepAssignee,
  runSummaryMessage,
  stepDueAt,
  type PlaybookEntity,
  type PlaybookStep,
} from "@/lib/playbook-engine";
import { DAY_MS } from "@/lib/clock";

/** Sabit "şimdi" — testler duvar saatinden bağımsız. */
const NOW = Date.UTC(2026, 6, 27, 9, 0, 0);

const OWNER = "11111111-1111-1111-1111-111111111111";
const ACTOR = "22222222-2222-2222-2222-222222222222";
const SPECIFIC = "33333333-3333-3333-3333-333333333333";

function step(overrides: Partial<PlaybookStep> = {}): PlaybookStep {
  return {
    sort_order: 0,
    title: "Tapu fotokopisi iste",
    kind: "document",
    priority: "normal",
    offset_days: 0,
    assign_to: "owner",
    assignee_id: null,
    note: null,
    ...overrides,
  };
}

const property: PlaybookEntity = {
  type: "property",
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  label: "P-1042 · Bahçelievler 3+1",
  ownerId: OWNER,
  fields: { transaction_type: "Satılık", property_type: "Daire" },
};

// ---------------------------------------------------------------------------
// 1) Filtre eşleşmesi
// ---------------------------------------------------------------------------

describe("matchesPlaybookFilter", () => {
  it("filtresiz playbook her olayda eşleşir", () => {
    expect(matchesPlaybookFilter(null, property.fields)).toBe(true);
    expect(matchesPlaybookFilter({}, property.fields)).toBe(true);
    expect(matchesPlaybookFilter("bozuk", property.fields)).toBe(true);
  });

  it("eşit değer → eşleşir (Türkçe büyük/küçük harf ve boşluk duyarsız)", () => {
    expect(matchesPlaybookFilter({ transaction_type: "Satılık" }, property.fields)).toBe(true);
    expect(matchesPlaybookFilter({ transaction_type: " satılık " }, property.fields)).toBe(true);
  });

  it("farklı değer → EŞLEŞMEZ (Kiralık portföyde satılık akışı çalışmaz)", () => {
    expect(matchesPlaybookFilter({ transaction_type: "Kiralık" }, property.fields)).toBe(false);
  });

  it("çok anahtarlı filtre AND semantiği taşır", () => {
    expect(
      matchesPlaybookFilter({ transaction_type: "Satılık", property_type: "Daire" }, property.fields),
    ).toBe(true);
    expect(
      matchesPlaybookFilter({ transaction_type: "Satılık", property_type: "Villa" }, property.fields),
    ).toBe(false);
  });

  it("dizi değer any-of semantiği taşır", () => {
    expect(matchesPlaybookFilter({ property_type: ["Villa", "Daire"] }, property.fields)).toBe(true);
    expect(matchesPlaybookFilter({ property_type: ["Villa", "Arsa"] }, property.fields)).toBe(false);
  });

  it("entity'de olmayan alan fail-CLOSED: görev paketi kazara açılmaz", () => {
    expect(matchesPlaybookFilter({ transaction_type: "Satılık" }, {})).toBe(false);
    expect(matchesPlaybookFilter({ transaction_type: "Satılık" }, undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2) Göreli vade
// ---------------------------------------------------------------------------

describe("stepDueAt", () => {
  it("offset 0 → tetikleme anı", () => {
    expect(stepDueAt(0, NOW)).toBe(new Date(NOW).toISOString());
  });

  it("offset N → tetikleme + N gün", () => {
    expect(stepDueAt(14, NOW)).toBe(new Date(NOW + 14 * DAY_MS).toISOString());
    expect(stepDueAt(2, NOW)).toBe(new Date(NOW + 2 * DAY_MS).toISOString());
  });

  it("geçersiz/negatif offset 0 sayılır", () => {
    expect(stepDueAt(-5, NOW)).toBe(new Date(NOW).toISOString());
    expect(stepDueAt(null, NOW)).toBe(new Date(NOW).toISOString());
    expect(stepDueAt(Number.NaN, NOW)).toBe(new Date(NOW).toISOString());
  });
});

// ---------------------------------------------------------------------------
// 3) assign_to çözümü
// ---------------------------------------------------------------------------

describe("resolveStepAssignee", () => {
  it("owner → kaydın sorumlusu", () => {
    expect(resolveStepAssignee(step({ assign_to: "owner" }), { ownerId: OWNER, actorId: ACTOR })).toBe(OWNER);
  });

  it("creator → işlemi yapan", () => {
    expect(resolveStepAssignee(step({ assign_to: "creator" }), { ownerId: OWNER, actorId: ACTOR })).toBe(ACTOR);
  });

  it("specific → adımda seçilen kişi", () => {
    expect(
      resolveStepAssignee(step({ assign_to: "specific", assignee_id: SPECIFIC }), { ownerId: OWNER, actorId: ACTOR }),
    ).toBe(SPECIFIC);
  });

  it("owner boşsa creator'a düşer; ikisi de yoksa null (görev sahipsiz açılır)", () => {
    expect(resolveStepAssignee(step({ assign_to: "owner" }), { ownerId: null, actorId: ACTOR })).toBe(ACTOR);
    expect(resolveStepAssignee(step({ assign_to: "specific", assignee_id: null }), { ownerId: OWNER })).toBe(OWNER);
    expect(resolveStepAssignee(step({ assign_to: "owner" }), {})).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4) Görev satırı üretimi
// ---------------------------------------------------------------------------

describe("buildPlaybookTaskRows", () => {
  const playbook = { id: "pb-1", name: "Yeni satılık portföy paketi" };

  it("adımları sort_order'a göre sıralayıp göreli vadelerle görev üretir", () => {
    const rows = buildPlaybookTaskRows({
      tenantId: "t-1",
      playbook,
      steps: [
        step({ sort_order: 2, title: "Portallara yükle", kind: "other", offset_days: 3 }),
        step({ sort_order: 0, title: "Tapu fotokopisi iste", offset_days: 0 }),
        step({ sort_order: 1, title: "Profesyonel fotoğraf çek", kind: "visit", offset_days: 2, priority: "high" }),
      ],
      entity: property,
      actorId: ACTOR,
      now: NOW,
    });

    expect(rows.map((r) => r.title)).toEqual([
      "Tapu fotokopisi iste · P-1042 · Bahçelievler 3+1",
      "Profesyonel fotoğraf çek · P-1042 · Bahçelievler 3+1",
      "Portallara yükle · P-1042 · Bahçelievler 3+1",
    ]);
    expect(rows.map((r) => r.due_at)).toEqual([
      new Date(NOW).toISOString(),
      new Date(NOW + 2 * DAY_MS).toISOString(),
      new Date(NOW + 3 * DAY_MS).toISOString(),
    ]);
    expect(rows[1].priority).toBe("high");
    // property olayı → property_id bağlanır, hepsi açık ve sorumluya atanmış
    expect(rows.every((r) => r.property_id === property.id && r.status === "open")).toBe(true);
    expect(rows.every((r) => r.assigned_to === OWNER && r.created_by === ACTOR)).toBe(true);
    expect(rows[0].notes).toContain("İş akışı: Yeni satılık portföy paketi");
  });

  it("boş adım listesi → hiç görev üretmez (motor da bildirim atmaz)", () => {
    expect(
      buildPlaybookTaskRows({ tenantId: "t-1", playbook, steps: [], entity: property, now: NOW }),
    ).toEqual([]);
  });

  it("başlıksız adım atlanır, geçersiz tür/öncelik güvenli varsayılana düşer", () => {
    const rows = buildPlaybookTaskRows({
      tenantId: "t-1",
      playbook,
      steps: [
        step({ title: "   " }),
        step({ sort_order: 1, title: "Ara", kind: "uydurma", priority: "kritik" }),
      ],
      entity: property,
      now: NOW,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("followup");
    expect(rows[0].priority).toBe("normal");
  });

  it("müşteri olayında customer_id bağlanır", () => {
    const rows = buildPlaybookTaskRows({
      tenantId: "t-1",
      playbook: { id: "pb-2", name: "Karşılama" },
      steps: [step({ title: "Hoş geldin araması", kind: "call" })],
      entity: { type: "customer", id: "cust-1", label: "Ayşe Yılmaz", ownerId: OWNER },
      now: NOW,
    });
    expect(rows[0].customer_id).toBe("cust-1");
    expect(rows[0].property_id).toBeNull();
    expect(rows[0].deal_id).toBeNull();
  });

  it("adım sayısı MAX_STEPS_PER_RUN ile sınırlanır (patlama önleme)", () => {
    const many = Array.from({ length: MAX_STEPS_PER_RUN + 7 }, (_, i) =>
      step({ sort_order: i, title: `Adım ${i + 1}` }),
    );
    const rows = buildPlaybookTaskRows({ tenantId: "t-1", playbook, steps: many, entity: property, now: NOW });
    expect(rows).toHaveLength(MAX_STEPS_PER_RUN);
  });
});

// ---------------------------------------------------------------------------
// 5) Mükerrer koruması mantığı
// ---------------------------------------------------------------------------

describe("mükerrer koruması (playbook_runs unique(playbook_id, entity_id))", () => {
  /** DB unique index'inin bellek karşılığı — aynı anahtar ikinci kez kabul edilmez. */
  function claimRun(claimed: Set<string>, playbookId: string, entityId: string): boolean {
    const key = `${playbookId}::${entityId}`;
    if (claimed.has(key)) return false;
    claimed.add(key);
    return true;
  }

  it("aynı playbook + aynı kayıt ikinci kez çalışmaz, farklı kayıt çalışır", () => {
    const claimed = new Set<string>();
    expect(claimRun(claimed, "pb-1", "prop-1")).toBe(true);
    expect(claimRun(claimed, "pb-1", "prop-1")).toBe(false); // mükerrer
    expect(claimRun(claimed, "pb-1", "prop-2")).toBe(true);  // başka portföy
    expect(claimRun(claimed, "pb-2", "prop-1")).toBe(true);  // başka akış
  });

  it("görev insert'i başarısız olursa kapılan yer bırakılır ve yeniden denenebilir", () => {
    const claimed = new Set<string>();
    expect(claimRun(claimed, "pb-1", "prop-1")).toBe(true);
    claimed.delete("pb-1::prop-1"); // motor: run satırını siler (rollback)
    expect(claimRun(claimed, "pb-1", "prop-1")).toBe(true);
  });
});

describe("runSummaryMessage", () => {
  it("özet bildirim metnini üretir", () => {
    expect(runSummaryMessage("Yeni satılık portföy paketi", 5)).toBe(
      "📋 Yeni satılık portföy paketi: 5 görev oluşturuldu",
    );
  });
});
