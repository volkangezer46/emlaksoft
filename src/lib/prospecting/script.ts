import { legalValue } from "@/lib/legal-constants";

/**
 * Arama script'i (SAF, statik; ofis düzenlemesi v2). Kurallar:
 * - Açılışta ofis ticaret unvanı ve yetki belge no söylenir (6563 sesli arama yükümlülüğü).
 * - Aydınlatma cümlesi hazırdır (KVKK md.10); "listemden çıkarırım" her zaman sunulur.
 * - "Daha yüksek fiyata satarım" vaadi YOK; emsal verisiyle konuşulur. Veri yoksa değer cümlesi GÖSTERİLMEZ (sahte vaat yok).
 * - Hizmet bedeli oranları elle yazılmaz: `legal-constants` tek kaynağından gelir (doğrulanmalı değerler).
 */
export type ScriptInput = {
  advisorName: string | null;
  officeName: string | null;
  licenseNo: string | null;
  districtName: string | null;
  rooms: string | null;
  portalLabel: string;
  /** Aynı bölgedeki aktif alıcı talebi sayısı; bilinmiyorsa/0 ise değer cümlesi çıkmaz. */
  activeBuyerDemands?: number | null;
};

export type ScriptSection = { title: string; lines: string[] };

const orBlank = (v: string | null | undefined, fallback: string) => (v && v.trim() ? v.trim() : fallback);

export function buildCallScript(i: ScriptInput): ScriptSection[] {
  const place = [i.districtName, i.rooms].filter((x) => x && x.trim()).join(" ");
  const sale = legalValue("saleCommissionCapPct");
  const rentMonths = legalValue("rentCommissionCapMonths");
  const opening = `Merhaba, ben ${orBlank(i.advisorName, "…")}, ${orBlank(i.officeName, "…")} adına arıyorum${i.licenseNo ? ` (yetki belge no ${i.licenseNo})` : ""}. ${place ? `${place} ilanınız için arıyorum, ` : "İlanınız için arıyorum, "}uygun musunuz?`;
  const sections: ScriptSection[] = [
    {
      title: "Açılış",
      lines: [
        opening,
        `Numaranızı ${i.portalLabel}'deki ilanınızdan aldım; yalnız bu ilanla ilgili görüşmek için kullanıyorum. İsterseniz sizi listemden hemen çıkarırım.`,
      ],
    },
  ];
  if (i.activeBuyerDemands && i.activeBuyerDemands > 0) {
    sections.push({ title: "Neden arıyorum", lines: [`Bu bölgede ${i.activeBuyerDemands} aktif alıcı talebimiz var; ilanınızla ilgilenebilecek kişilerimiz olabilir.`] });
  }
  sections.push(
    { title: "Soru (ilişki kurun, yetki istemeyin)", lines: ["Fiyatı nasıl belirlediniz? Ne zamana kadar satmayı düşünüyorsunuz?"] },
    {
      title: "İtirazlar",
      lines: [
        `"Komisyon ödemem" → Hizmet bedeli yazılı sözleşmede belirlenir; yönetmelikteki üst sınır satışta KDV hariç toplam %${sale}, kirada ${rentMonths} aylık kira tutarıdır (güncel metni doğrulayın). Ne sunduğumuzu anlatayım.`,
        `"Kendim satarım" → Uygun alıcı çıkarsa size getireyim mi? Yetki vermeniz gerekmez.`,
        `"Çok emlakçı aradı" → Anlıyorum; listemden çıkarmamı ister misiniz? (Evet derse "Aranmasın" düğmesi)`,
      ],
    },
    { title: "Kapanış", lines: ["Sizi hangi gün tekrar arayabilirim? (Tarihi \"Sonra ara\" ile kaydedin.)", "\"Tekrar aranmak istemiyorum\" derse tek dokunuşla Aranmasın."] },
  );
  return sections;
}

/** Arama ekranı uyarısı (İYS/KVKK engel değil, hatırlatır). */
export const CALL_NOTICE =
  "İlan sahibini arayabilirsiniz; toplu SMS/WhatsApp göndermeyin. Kişi 'aramayın' derse Aranmasın'a ekleyin. Görüşmenin başında ofis unvanınızı ve yetki belge numaranızı söyleyin.";
