import { describe, expect, it } from "vitest";
import { contactsFromRows, phoneChoices, whatsappPhone, isMissingRelationError, type CustomerContact } from "@/lib/customer-contacts";
import { inverseRelation, relationViews, RELATION_KINDS, type RelationRow } from "@/lib/customer-relations";
import {
  countNotes,
  filterNotes,
  matchMembers,
  mentionQueryAt,
  notesFromRows,
  resolveMentions,
  sortNotes,
  splitMentions,
  type CustomerNote,
} from "@/lib/customer-notes";

const c = (id: string, kind: "phone" | "email", value: string, label: CustomerContact["label"] = "cep"): CustomerContact => ({ id, kind, value, label, created_at: "2026-10-01T00:00:00Z" });

describe("ek iletişim (CRM-G7)", () => {
  it("numara seçici: birincil önce, WhatsApp etiketli ek numara sonra, tekrar yok", () => {
    const list = phoneChoices("05321112233", [c("1", "phone", "05449998877", "is"), c("2", "phone", "05551112233", "whatsapp"), c("3", "phone", "0532 111 22 33"), c("4", "email", "a@b.co")]);
    expect(list.map((x) => [x.value, x.label])).toEqual([
      ["05321112233", "Birincil"],
      ["05551112233", "WhatsApp"],
      ["05449998877", "İş"],
    ]);
  });

  it("WhatsApp varsayılanı: etiketli numara, yoksa birincil", () => {
    expect(whatsappPhone("05321112233", [c("2", "phone", "05551112233", "whatsapp")])).toBe("05551112233");
    expect(whatsappPhone("05321112233", [c("1", "phone", "05449998877", "is")])).toBe("05321112233");
    expect(whatsappPhone(null, [])).toBeNull();
  });

  it("satırlar güvenle türetilir; tanınmayan etiket 'diğer'", () => {
    expect(contactsFromRows([{ id: "x", kind: "phone", value: "05", label: "uydurma" }, { id: "y", kind: "fax", value: "1" }, null])).toEqual([
      { id: "x", kind: "phone", value: "05", label: "diger", created_at: "" },
    ]);
  });

  it("migration öncesi hata kodları tanınır", () => {
    expect(isMissingRelationError({ code: "42P01" })).toBe(true);
    expect(isMissingRelationError({ code: "PGRST205", message: "Could not find the table in the schema cache" })).toBe(true);
    expect(isMissingRelationError({ code: "23505" })).toBe(false);
    expect(isMissingRelationError(null)).toBe(false);
  });
});

describe("ilişkili kişiler (CRM-G8)", () => {
  it("her türün tersi tanımlı ve ters tersi kendisi", () => {
    for (const k of RELATION_KINDS) expect(inverseRelation(inverseRelation(k))).toBe(k);
    expect(inverseRelation("sirket_yetkilisi")).toBe("sirket");
    expect(inverseRelation("es")).toBe("es");
  });

  it("iki yönlü okuma: karşı taraf ve doğru etiket; okunamayan kişi atlanır", () => {
    const rows: RelationRow[] = [
      { id: "r1", customer_id: "A", related_customer_id: "B", relation: "sirket_yetkilisi", note: null, created_at: "", related: { id: "B", full_name: "Bora", phone: null }, customer: { id: "A", full_name: "ACME AŞ", phone: null } },
      { id: "r2", customer_id: "C", related_customer_id: "A", relation: "avukat", note: "dosya", created_at: "", related: [{ id: "A", full_name: "ACME AŞ", phone: null }], customer: [{ id: "C", full_name: "Cem", phone: "05321112233" }] },
      { id: "r3", customer_id: "A", related_customer_id: "D", relation: "es", note: null, created_at: "", related: null },
    ];
    const fromA = relationViews(rows, "A");
    expect(fromA.map((v) => [v.person.full_name, v.label])).toEqual([["Bora", "Şirket yetkilisi"], ["Cem", "Müvekkili"]]);
    const fromB = relationViews(rows, "B");
    expect(fromB.map((v) => [v.person.full_name, v.label])).toEqual([["ACME AŞ", "Yetkilisi olduğu şirket"]]);
  });
});

describe("yapılandırılmış notlar (CRM-G9)", () => {
  const members = [{ id: "u1", name: "Ayşe Yılmaz" }, { id: "u2", name: "Mehmet Öz" }, { id: "u3", name: "Ayten Kara" }];
  const note = (o: Partial<CustomerNote>): CustomerNote => ({ id: "n", body: "x", subject: null, created_at: "2026-10-01T10:00:00Z", pinned_at: null, mentioned_user_ids: [], author_id: "u1", author_name: "Ayşe", origin: null, ...o });

  it("@ sorgusu yalnız kelime başında açılır", () => {
    expect(mentionQueryAt("Merhaba @Ay", 11)).toEqual({ start: 8, query: "Ay" });
    expect(mentionQueryAt("ali@ornek", 9)).toBeNull();
    expect(mentionQueryAt("@", 1)).toEqual({ start: 0, query: "" });
    expect(matchMembers(members, "ay").map((m) => m.id)).toEqual(["u1", "u3"]);
    expect(matchMembers(members, "öz").map((m) => m.id)).toEqual(["u2"]);
  });

  it("bildirim yalnız metinde hâlâ anılan ekip üyelerine gider", () => {
    expect(resolveMentions("@Ayşe Yılmaz kredi onayı çıktı", ["u1", "u2", "yabanci"], members)).toEqual(["u1"]);
    expect(resolveMentions("@ayşe yılmaz", ["u1"], members)).toEqual(["u1"]);
  });

  it("süzgeç, sayaç ve sıralama: sabitlenen önce", () => {
    const list = [
      note({ id: "a", created_at: "2026-10-03T00:00:00Z" }),
      note({ id: "b", pinned_at: "2026-10-04T00:00:00Z", author_id: "u2" }),
      note({ id: "c", mentioned_user_ids: ["u1"], author_id: "u2", created_at: "2026-10-05T00:00:00Z" }),
    ];
    expect(sortNotes(list).map((n) => n.id)).toEqual(["b", "c", "a"]);
    expect(filterNotes(list, "bana", "u1").map((n) => n.id)).toEqual(["c"]);
    expect(filterNotes(list, "benim", "u1").map((n) => n.id)).toEqual(["a"]);
    expect(countNotes(list, "u1")).toEqual({ tum: 3, sabit: 1, bana: 1, benim: 1 });
  });

  it("anma vurgusu ve satır türetme", () => {
    expect(splitMentions("Selam @Mehmet Öz, bak", ["Mehmet Öz"])).toEqual([
      { text: "Selam ", mention: false },
      { text: "@Mehmet Öz", mention: true },
      { text: ", bak", mention: false },
    ]);
    const rows = notesFromRows([
      { id: "1", body: "", subject: "Konu", created_at: "t", author: [{ id: "u1", full_name: "Ayşe" }], mentioned_user_ids: ["u2", 3] },
      { id: "2", body: "", subject: null },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ body: "Konu", author_id: "u1", mentioned_user_ids: ["u2"] });
  });
});
