import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canonicalGrantorName,
  dealKindOfTransaction,
  foldTurkish,
  maskGrantorName,
  matchExact,
  MAX_EIDS_CANDIDATES,
  namesMatch,
  rankCandidates,
  scoreCandidate,
  trigramSimilarity,
  type EidsMatchProperty,
} from "./match";
import { eidsNoMatchKey } from "./property-no";

const prop = (over: Partial<EidsMatchProperty> & { id: string }): EidsMatchProperty => ({
  eids_property_no: null,
  transaction_type: "Satılık",
  authorization_end: "2027-01-15",
  owner_name: "Ahmet Yılmaz",
  ...over,
});

describe("eidsNoMatchKey (taşınmaz no normalleştirme)", () => {
  it("yalnız rakamlar kalır, baştaki sıfırlar korunur", () => {
    expect(eidsNoMatchKey("12.345.678")).toBe("12345678");
    expect(eidsNoMatchKey(" 00123456 ")).toBe("00123456");
    expect(eidsNoMatchKey("TK-001234-56")).toBe("00123456");
  });
  it("6 rakamdan kısa ya da boş değer eşleşmez", () => {
    expect(eidsNoMatchKey("12345")).toBeNull();
    expect(eidsNoMatchKey("")).toBeNull();
    expect(eidsNoMatchKey(null)).toBeNull();
  });
});

describe("Türkçe ad karşılaştırma", () => {
  it("büyük/küçük harf ve Türkçe karakter duyarsız", () => {
    expect(foldTurkish("İSMAİL ÇAĞLAR")).toBe("ismail caglar");
    expect(foldTurkish("ŞÜKRÜ IŞIK")).toBe("sukru isik");
    expect(namesMatch("AHMET YILMAZ", "Ahmet Yılmaz")).toBe(true);
    expect(namesMatch("Yılmaz Ahmet", "ahmet yilmaz")).toBe(true);
    expect(namesMatch("Ahmet Can Yılmaz", "Ahmet Yılmaz")).toBe(true);
    expect(namesMatch("Ayşe Demir", "Ahmet Yılmaz")).toBe(false);
    expect(namesMatch("", "Ahmet")).toBe(false);
  });
  it("trigram benzerliği pg_trgm gibi 0..1 ve Türkçe katlamalı", () => {
    expect(trigramSimilarity("Ahmet Yılmaz", "AHMET YILMAZ")).toBe(1);
    expect(trigramSimilarity("Ahmet Yılmaz", "Ahmet Yilmaz")).toBe(1);
    const near = trigramSimilarity("Ahmet Yılmaz", "Ahmet Yılmazoğlu");
    expect(near).toBeGreaterThan(0.4);
    expect(near).toBeLessThan(1);
    expect(trigramSimilarity("Ahmet Yılmaz", "Zeynep Kaya")).toBeLessThan(0.1);
  });
  it("maske ve kanonik ad (açık ad saklanmaz)", () => {
    expect(maskGrantorName("Ahmet Yılmaz")).toBe("Ah*** Yı****");
    expect(maskGrantorName("Al")).toBe("A*");
    expect(maskGrantorName("  ")).toBeNull();
    expect(canonicalGrantorName("YILMAZ Ahmet")).toBe(canonicalGrantorName("ahmet yılmaz"));
  });
});

describe("dealKindOfTransaction", () => {
  it("serbest metinden satış/kiralama", () => {
    expect(dealKindOfTransaction("Satılık")).toBe("sale");
    expect(dealKindOfTransaction("satilik")).toBe("sale");
    expect(dealKindOfTransaction("Kiralık")).toBe("rent");
    expect(dealKindOfTransaction("kiralik")).toBe("rent");
    expect(dealKindOfTransaction("rent")).toBe("rent");
    expect(dealKindOfTransaction("Devren")).toBeNull();
    expect(dealKindOfTransaction(null)).toBeNull();
  });
});

describe("matchExact (birebir eşleştirme)", () => {
  it("aynı no ofiste tek portföydeyse o portföy seçilir (ayraç/biçim farkı önemsiz)", () => {
    const rows = [prop({ id: "a", eids_property_no: "12345678" }), prop({ id: "b", eids_property_no: "87654321" })];
    const r = matchExact({ propertyNo: "12.345.678", dealKind: "sale", grantorName: "AHMET YILMAZ", validUntil: "2027-01-15" }, rows);
    expect(r).toEqual({ kind: "exact", propertyId: "a", warnings: [], endDateDiffDays: 0 });
  });
  it("iki portföy (satış ve kiralama) varsa bildirimdeki türle doğru olan seçilir", () => {
    const rows = [
      prop({ id: "sat", eids_property_no: "12345678", transaction_type: "Satılık" }),
      prop({ id: "kira", eids_property_no: "12345678", transaction_type: "Kiralık" }),
    ];
    expect(matchExact({ propertyNo: "12345678", dealKind: "rent" }, rows)).toMatchObject({ kind: "exact", propertyId: "kira" });
    expect(matchExact({ propertyNo: "12345678", dealKind: "sale" }, rows)).toMatchObject({ kind: "exact", propertyId: "sat" });
  });
  it("tür bilinmiyorsa ya da ayırt etmiyorsa belirsiz kalır (otomatik bağlama yok)", () => {
    const rows = [prop({ id: "x", eids_property_no: "12345678" }), prop({ id: "y", eids_property_no: "12345678" })];
    expect(matchExact({ propertyNo: "12345678" }, rows)).toEqual({ kind: "ambiguous", propertyIds: ["x", "y"] });
    expect(matchExact({ propertyNo: "12345678", dealKind: "sale" }, rows)).toEqual({ kind: "ambiguous", propertyIds: ["x", "y"] });
  });
  it("baştaki sıfır korunur: 00123456 ile 123456 aynı taşınmaz değildir", () => {
    const rows = [prop({ id: "a", eids_property_no: "123456" })];
    expect(matchExact({ propertyNo: "00123456" }, rows)).toEqual({ kind: "none" });
  });
  it("malik farklıysa eşleşme bozulmaz, yalnız uyarı düşer (hisseli taşınmaz)", () => {
    const rows = [prop({ id: "a", eids_property_no: "12345678", owner_name: "Ayşe Demir" })];
    const r = matchExact({ propertyNo: "12345678", grantorName: "Mehmet Demir" }, rows);
    expect(r).toMatchObject({ kind: "exact", propertyId: "a" });
    expect(r.kind === "exact" && r.warnings).toEqual(["owner_mismatch"]);
  });
  it("bitiş tarihi authorization_end ile karşılaştırılır; tür uyuşmazlığı uyarıdır", () => {
    const rows = [prop({ id: "a", eids_property_no: "12345678", authorization_end: "2027-01-01" })];
    const r = matchExact({ propertyNo: "12345678", validUntil: "2027-03-01", dealKind: "rent", grantorName: "Ahmet Yılmaz" }, rows);
    expect(r).toMatchObject({ kind: "exact", endDateDiffDays: 59 });
    expect(r.kind === "exact" && r.warnings).toEqual(["deal_kind_mismatch", "end_date_mismatch"]);
    const noEnd = matchExact({ propertyNo: "12345678", validUntil: "2027-03-01" }, [prop({ id: "a", eids_property_no: "12345678", authorization_end: null })]);
    expect(noEnd.kind === "exact" && noEnd.warnings).toEqual(["end_date_missing"]);
  });
  it("numara yoksa ya da eşleşme yoksa", () => {
    expect(matchExact({ propertyNo: "abc" }, [])).toEqual({ kind: "invalid", reason: "no_property_no" });
    expect(matchExact({ propertyNo: "99999999" }, [prop({ id: "a", eids_property_no: "12345678" })])).toEqual({ kind: "none" });
  });
});

describe("rankCandidates (aday listesi)", () => {
  const many = Array.from({ length: 9 }, (_, i) => prop({ id: `p${i}`, owner_name: i % 2 === 0 ? "Ahmet Yılmaz" : "Ahmet Yılmazer", eids_property_no: null }));
  it("en çok 5 aday döner ve otomatik bağlama yapmaz (yalnız liste)", () => {
    const c = rankCandidates({ propertyNo: "12345678", grantorName: "AHMET YILMAZ" }, many);
    expect(c).toHaveLength(MAX_EIDS_CANDIDATES);
    expect(c[0]!.nameSimilarity).toBe(1);
    expect(rankCandidates({ propertyNo: "12345678", grantorName: "Ahmet Yılmaz" }, many, 50)).toHaveLength(5);
  });
  it("puan: ad benzerliği + mahalle/ilçe + EİDS no boşluğu; başka no'lu portföy aday değildir", () => {
    const rows = [
      prop({ id: "bos", owner_name: "Ahmet Yılmaz", eids_property_no: null }),
      prop({ id: "dolu", owner_name: "Ahmet Yılmaz", eids_property_no: "55555555" }),
      prop({ id: "mahalle", owner_name: "Ahmet Yılmazoğlu", eids_property_no: null, neighborhood_id: "n1" }),
      prop({ id: "alakasiz", owner_name: "Zeynep Kaya", eids_property_no: null }),
    ];
    const c = rankCandidates({ propertyNo: "12345678", grantorName: "Ahmet Yılmaz", neighborhoodId: "n1", dealKind: "sale" }, rows);
    expect(c.map((x) => x.propertyId)).toEqual(["bos", "mahalle"]);
    expect(c[0]!.score).toBe(scoreCandidate({ nameSimilarity: 1, eidsNoEmpty: true, dealKindMatches: true }));
    expect(c[0]!.reasons).toContain("Taşınmaz no girilmemiş");
  });
  it("konum ipucu benzerlik eşiğinin altındaki adayı da getirir", () => {
    const rows = [prop({ id: "ilce", owner_name: "Zeynep Kaya", district_id: "d1" })];
    expect(rankCandidates({ propertyNo: "12345678", grantorName: "Ahmet Yılmaz", districtId: "d1" }, rows).map((x) => x.propertyId)).toEqual(["ilce"]);
    expect(rankCandidates({ propertyNo: "12345678", grantorName: "Ahmet Yılmaz" }, rows)).toEqual([]);
  });
  it("pg_trgm benzerliği verilirse o kullanılır", () => {
    const c = rankCandidates({ propertyNo: "12345678", grantorName: "x" }, [{ ...prop({ id: "a" }), nameSimilarity: 0.5 }]);
    expect(c[0]!.nameSimilarity).toBe(0.5);
  });
  it("puan sınırları 0..100", () => {
    expect(scoreCandidate({ nameSimilarity: 1, sameNeighborhood: true, eidsNoEmpty: true, dealKindMatches: true })).toBe(100);
    expect(scoreCandidate({ nameSimilarity: 0, eidsNoEmpty: false })).toBe(0);
    expect(scoreCandidate({ nameSimilarity: 2, eidsNoEmpty: false })).toBe(60);
  });
});

describe("yetki defteri sözleşmesi", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  it("match.ts saf: DB/React/zaman yok", () => {
    const src = read("src/lib/eids/match.ts");
    expect(src).not.toMatch(/supabase|from "react"|Date\.now\(\)|new Date\(\)/);
  });
  it("tek yazma noktası: authority_eids_status yalnız ledger RPC'leriyle yazılır", () => {
    for (const f of ["src/app/actions/authority-queue.ts", "src/lib/eids/ledger.ts"]) {
      const src = read(f);
      expect(src).not.toMatch(/createAdminClient/);
    }
    const ledger = read("src/lib/eids/ledger.ts");
    expect(ledger).toContain('rpc("eids_apply_authority_event"');
    expect(ledger).toContain('rpc("eids_undo_authority_event"');
    // Kuyruk eylemleri durum yazarken defterden geçer; doğrudan yazım yalnız defter kurulmamışken (schema_pending) eski yoldur.
    const actions = read("src/app/actions/authority-queue.ts");
    const direct = actions.match(/\.update\(\{[^}]*authority_eids_status/g) ?? [];
    expect(direct.length).toBe(1);
    expect(actions.indexOf('res.code === "schema_pending"')).toBeLessThan(actions.search(/\.update\(\{[^}]*authority_eids_status/));
  });
  it("migration: genişleyen CHECK, yalnız-eklenir tablo, RLS ve rollback", () => {
    const sql = read("supabase/migrations/20261013007100_eids_authority_ledger.sql");
    expect(sql).toContain("check (authority_eids_status in ('unknown', 'pending', 'approved', 'expired', 'revoked', 'rejected'))");
    expect(sql).toContain("create table if not exists public.eids_authority_events");
    expect(sql).toContain("before update or delete on public.eids_authority_events");
    expect(sql).toContain("before truncate on public.eids_authority_events");
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("security invoker");
    expect(sql).not.toMatch(/security definer/i);
    expect(sql).not.toMatch(/grant [^;]*(update|delete)[^;]*on table public\.eids_authority_events/i);
    const rb = read("supabase/rollbacks/20261013007100_eids_authority_ledger.rollback.sql");
    expect(rb).toContain("drop table if exists public.eids_authority_events");
    expect(rb).toContain("check (authority_eids_status in ('pending', 'approved', 'rejected'))");
  });
  it("yayın ve portal aktarımı EİDS kapısından geçer", () => {
    expect(read("src/app/actions/portal-publish.ts")).toMatch(/authorityPublishGate\([\s\S]*if \(authGate\.blocked\) return \{ error: authGate\.error \}/);
    expect(read("src/app/actions/portal-transfer.ts")).toMatch(/authorityPublishGate\([\s\S]*if \(authGate\.blocked\) return \{ ok: false, error: authGate\.error \}/);
  });
});
