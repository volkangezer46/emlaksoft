import { describe, expect, it } from "vitest";
import {
  contactsToTable,
  decodeQuotedPrintable,
  looksLikeVCard,
  parseVCards,
  pickedContactsToTable,
  pickPrimaryPhone,
  unfoldVCardLines,
  vcardToTable,
  VCARD_HEADERS,
} from "./vcard-import";

const V3 = [
  "BEGIN:VCARD",
  "VERSION:3.0",
  "FN:Ayşe Yılmaz",
  "N:Yılmaz;Ayşe;;;",
  "TEL;TYPE=HOME,VOICE:0216 333 44 55",
  "item1.TEL;TYPE=CELL:+90 532 123 45 67",
  "EMAIL;TYPE=INTERNET:ayse@example.com",
  "NOTE:3+1 arıyor\\, Kadıköy",
  "CATEGORIES:Alıcı,Yatırımcı",
  "ADR;TYPE=HOME:;;Moda Cad. 12;Kadıköy;İstanbul;34710;Türkiye",
  "END:VCARD",
].join("\r\n");

// Android 2.1 dışa aktarımı: QUOTED-PRINTABLE + UTF-8, yumuşak satır sonu, FN yok
const V21 = [
  "BEGIN:VCARD",
  "VERSION:2.1",
  "N;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:=C3=96zt=C3=BCrk;=C5=9Eule;;;",
  "TEL;CELL:05551112233",
  "TEL;CELL;PREF:05551112233",
  "NOTE;ENCODING=QUOTED-PRINTABLE:Uzun not sat=",
  "=C4=B1r=C4=B1",
  "END:VCARD",
].join("\n");

describe("vCard ayrıştırma", () => {
  it("vCard 3.0: ad, cep öncelikli telefon, e-posta, not kaçışı, etiket, il/ilçe", () => {
    const [c] = parseVCards(V3);
    expect(c!.fullName).toBe("Ayşe Yılmaz");
    expect(pickPrimaryPhone(c!.phones)).toEqual({ primary: "+90 532 123 45 67", others: ["0216 333 44 55"] });
    expect(c!.emails).toEqual(["ayse@example.com"]);
    expect(c!.note).toBe("3+1 arıyor, Kadıköy");
    expect(c!.categories).toEqual(["Alıcı", "Yatırımcı"]);
    expect(c!.city).toBe("Kadıköy / İstanbul");
  });

  it("vCard 2.1: QUOTED-PRINTABLE Türkçe karakter, N'den ad, yinelenen numara tekilleşir", () => {
    const [c] = parseVCards(V21);
    expect(c!.fullName).toBe("Şule Öztürk");
    expect(c!.note).toBe("Uzun not satırı");
    expect(pickPrimaryPhone(c!.phones).others).toEqual([]);
  });

  it("satır katlaması açılır", () => {
    expect(unfoldVCardLines("NOTE:abc\r\n def\r\n\tghi")).toEqual(["NOTE:abcdefghi"]);
    expect(decodeQuotedPrintable("=C4=9Fa", "utf-8")).toBe("ğa");
  });

  it("tablo çıktısı CSV ile aynı biçim; iletişimsiz kart atlanır", () => {
    const t = vcardToTable(`${V3}\n${V21}\nBEGIN:VCARD\nVERSION:3.0\nFN:Sadece Ad\nEND:VCARD`);
    expect(t.headers).toEqual([...VCARD_HEADERS]);
    expect(t.rows).toHaveLength(2);
    expect(t.skipped).toBe(1);
    expect(t.rows[0]).toEqual(["Ayşe Yılmaz", "+90 532 123 45 67", "ayse@example.com", "3+1 arıyor, Kadıköy", "Alıcı; Yatırımcı", "Kadıköy / İstanbul", "0216 333 44 55"]);
    expect(looksLikeVCard(`﻿${V3}`)).toBe(true);
    expect(looksLikeVCard("Ad;Telefon")).toBe(false);
  });

  it("Contact Picker sonucu aynı tabloya çevrilir", () => {
    const t = pickedContactsToTable([{ name: ["Ali Kaya"], tel: ["0532 000 11 22"], email: [] }, { name: [], tel: [], email: [] }]);
    expect(t.rows).toEqual([["Ali Kaya", "0532 000 11 22", "", "", "", "", ""]]);
    expect(t.skipped).toBe(1);
    expect(contactsToTable([]).rows).toEqual([]);
  });
});
