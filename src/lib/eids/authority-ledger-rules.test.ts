import { describe, expect, it } from "vitest";
import {
  canSendReminder,
  classifyAuthority,
  eidsDisplayStatus,
  validateManualAuthorityTerm,
  type AuthorityQueueRow,
} from "@/lib/eids/authority-status";
import { authorityPublishBlock } from "@/lib/authority-shield";
import { eidsHealthValue } from "@/lib/eids/health";
import { activeOverride, undoableEvent, type AuthorityEventRow } from "@/lib/eids/load";
import { summarizeEids } from "@/lib/eids/status";

const NOW = Date.UTC(2026, 9, 8, 9, 0, 0); // 8 Ekim 2026 12:00 TR

const row = (over: Partial<AuthorityQueueRow> = {}): AuthorityQueueRow => ({
  id: "p1",
  status: "live",
  authorization_start: "2026-06-01",
  authorization_end: "2027-06-01",
  authority_doc_no: "YB-1",
  authority_eids_status: "approved",
  authority_owner_approved_at: "2026-06-02T00:00:00Z",
  authority_reminder_sent_at: null,
  authority_reminder_count: 0,
  ...over,
});

describe("genişletilmiş durum modeli (EP2)", () => {
  it("iptal her şeyin önündedir; süresi dolmuş tarihten ya da kayıttan gelir", () => {
    expect(eidsDisplayStatus(row({ authority_eids_status: "revoked", authorization_end: "2026-01-01" }), NOW)).toBe("revoked");
    expect(eidsDisplayStatus(row({ authority_eids_status: "expired" }), NOW)).toBe("expired");
    expect(eidsDisplayStatus(row({ authority_eids_status: "unknown" }), NOW)).toBe("unknown");
  });
  it("'bitiyor' saklanmaz: onaylı + 15 gün içinde bitiş", () => {
    expect(eidsDisplayStatus(row({ authorization_end: "2026-10-20" }), NOW)).toBe("expiring");
    expect(eidsDisplayStatus(row({ authority_eids_status: "pending", authorization_end: "2026-10-20" }), NOW)).toBe("pending");
  });
  it("istisna işaretli portföy EİDS kontrolünden çıkar (yazılı yetki süresi kovaları sürer)", () => {
    const r = row({ authority_eids_status: "unknown", eids_exempt_reason: "no_deed", authority_doc_no: null });
    expect(eidsDisplayStatus(r, NOW)).toBe("exempt");
    expect(classifyAuthority(r, NOW).buckets).toEqual(["belgesiz"]);
    expect(classifyAuthority({ ...r, authorization_end: "2026-10-01" }, NOW).buckets).toEqual(["dolmus", "belgesiz"]);
    expect(canSendReminder({ ...r }, NOW).ok).toBe(false);
  });
  it("yeni kovalar: iptal, bilinmiyor, teyitsiz (yalnız ölçülebiliyorsa)", () => {
    expect(classifyAuthority(row({ authority_eids_status: "revoked" }), NOW).buckets).toEqual(["iptal"]);
    expect(classifyAuthority(row({ authority_eids_status: "rejected" }), NOW).buckets).toEqual(["iptal"]);
    expect(classifyAuthority(row({ authority_eids_status: "unknown" }), NOW).buckets).toEqual(["bilinmiyor"]);
    expect(classifyAuthority(row({ authority_last_email_at: null, authority_eids_verified_at: null }), NOW).buckets).toEqual(["teyitsiz"]);
    expect(classifyAuthority(row({ authority_last_email_at: "2026-09-01T00:00:00Z", authority_eids_verified_at: null }), NOW).buckets).toEqual([]);
    // Sütun okunamadıysa (undefined) teyitsiz ÖLÇÜLMEZ: sahte uyarı yok.
    expect(classifyAuthority(row(), NOW).buckets).toEqual([]);
  });
  it("İlan Kontrol EİDS özeti: istisna 'EİDS no eksik' sayılmaz", () => {
    const s = summarizeEids(
      [
        { id: "a", status: "live", eids_property_no: null, authorization_start: null, authorization_end: null, eids_exempt_reason: "foreign_owner" },
        { id: "b", status: "live", eids_property_no: null, authorization_start: null, authorization_end: null },
      ],
      NOW,
    );
    expect(s.ids.eids_eksik).toEqual(["b"]);
  });
});

describe("yayın engeli (iptal/dolmuş)", () => {
  it("iptal ve süresi dolmuş yetki engellenir; mesaj 'ne oldu, ne yapmalı'", () => {
    const b = authorityPublishBlock(row({ authority_eids_status: "revoked" }), NOW);
    expect(b?.code).toBe("revoked");
    expect(b?.message).toMatch(/^Ne oldu: .*Ne yapmalı: /);
    expect(authorityPublishBlock(row({ authorization_end: "2026-10-01" }), NOW)?.code).toBe("expired");
    expect(authorityPublishBlock(row({ authority_eids_status: "expired" }), NOW)?.code).toBe("expired");
  });
  it("onaylı, bekleyen ve bilinmeyen engellenmez; owner izni engeli kaldırır", () => {
    expect(authorityPublishBlock(row(), NOW)).toBeNull();
    expect(authorityPublishBlock(row({ authority_eids_status: "pending" }), NOW)).toBeNull();
    expect(authorityPublishBlock(row({ authority_eids_status: "unknown" }), NOW)).toBeNull();
    expect(authorityPublishBlock(row({ authority_eids_status: "revoked" }), NOW, true)).toBeNull();
  });
});

const ev = (over: Partial<AuthorityEventRow> & { id: string; kind: string }): AuthorityEventRow => ({
  seq: 1,
  source: "manual",
  prev_status: null,
  new_status: null,
  valid_until: null,
  deal_kind: null,
  grantor_masked: null,
  eids_property_no: null,
  actor_id: null,
  undo_of: null,
  note: null,
  evidence_media_id: null,
  inbound_message_id: null,
  created_at: new Date(NOW - 3_600_000).toISOString(),
  ...over,
});

describe("geri alma ve owner izni (defter okuması)", () => {
  it("geri alınabilir olay: override dışındaki en yeni olay, geri alma değilse ve geri alınmamışsa", () => {
    expect(undoableEvent([ev({ id: "o", kind: "override" }), ev({ id: "r", kind: "revoke" })])?.id).toBe("r");
    expect(undoableEvent([ev({ id: "u", kind: "undo", undo_of: "r" }), ev({ id: "r", kind: "revoke" })])).toBeNull();
    expect(undoableEvent([])).toBeNull();
  });
  it("owner izni yalnız son durum olayından sonra ve süresi içinde geçerlidir", () => {
    const fresh = ev({ id: "o", kind: "override", note: "malik teyit etti" });
    expect(activeOverride([fresh, ev({ id: "r", kind: "revoke" })], NOW, 24)?.id).toBe("o");
    expect(activeOverride([ev({ id: "o", kind: "override", created_at: new Date(NOW - 25 * 3_600_000).toISOString() })], NOW, 24)).toBeNull();
    // İzinden sonra yeni bir iptal geldiyse izin düşer.
    expect(activeOverride([ev({ id: "r2", kind: "revoke" }), fresh], NOW, 24)).toBeNull();
  });
});

describe("elle giriş: en az 3 ay kuralı", () => {
  it("3 aydan kısa bitiş reddedilir ve 'ne oldu, ne yapmalı' der", () => {
    const r = validateManualAuthorityTerm({ grantedOn: "2026-10-01", validUntil: "2026-12-31" }, NOW);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/^Ne oldu: .*3 aydan kısa.*Ne yapmalı: .*01\.01\.2027/);
  });
  it("tam 3 ay ve üstü geçerli; veriliş boşsa bugün sayılır", () => {
    expect(validateManualAuthorityTerm({ grantedOn: "2026-10-01", validUntil: "2027-01-01" }, NOW).ok).toBe(true);
    expect(validateManualAuthorityTerm({ validUntil: "2027-01-08" }, NOW).ok).toBe(true);
    expect(validateManualAuthorityTerm({ validUntil: "2027-01-07" }, NOW).ok).toBe(false);
    expect(validateManualAuthorityTerm({ validUntil: "" }, NOW).ok).toBe(true);
  });
  it("bozuk ya da ters tarih", () => {
    expect(validateManualAuthorityTerm({ validUntil: "31.12.2026" }, NOW).ok).toBe(false);
    expect(validateManualAuthorityTerm({ grantedOn: "2027-05-01", validUntil: "2027-01-01" }, NOW).ok).toBe(false);
  });
});

describe("sağlık skoru: defter durumu", () => {
  it("iptal/dolmuş/reddedilmiş = 0, istisna ölçüm dışı, eski imza aynı", () => {
    expect(eidsHealthValue(true, false, { status: "revoked" })).toBe(0);
    expect(eidsHealthValue(true, false, { status: "expired" })).toBe(0);
    expect(eidsHealthValue(null, false, { status: "rejected" })).toBe(0);
    expect(eidsHealthValue(false, false, { exempt: true })).toBeNull();
    expect(eidsHealthValue(true, true, { status: "approved" })).toBe(0.5);
    expect(eidsHealthValue(true)).toBe(1);
  });
});
