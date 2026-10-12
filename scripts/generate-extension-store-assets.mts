// Chrome Web Store görselleri (1280x800 ekran görüntüleri, 440x280 ve 1400x560 tanıtım; 24 bit PNG, alfa yok).
// Çalıştır: npx tsx scripts/generate-extension-store-assets.mts  -> extensions/emlaksoft-ilan-kontrol/store/
import { chromium } from "@playwright/test";
import sharp from "sharp";
import { readFileSync, mkdirSync } from "node:fs";

const OUT = "extensions/emlaksoft-ilan-kontrol/store";
mkdirSync(OUT, { recursive: true });
const icon = readFileSync("public/icon.svg", "utf8").replace(/<\?xml[^>]*>/, "");

const base = `
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:"Segoe UI",system-ui,sans-serif;color:#0f1d33;-webkit-font-smoothing:antialiased}
.bg{position:absolute;inset:0;background:radial-gradient(1200px 600px at 85% -10%,#1b3a78 0%,transparent 60%),linear-gradient(135deg,#071a38 0%,#0d2752 55%,#071a38 100%)}
.glow{position:absolute;border-radius:50%;filter:blur(60px);opacity:.35}
.brand{display:flex;align-items:center;gap:12px;color:#fff;font-weight:700}
.brand svg{width:44px;height:44px;border-radius:12px}
.gold{color:#f6d27a}
.chip{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;font-size:13px;font-weight:600}
.card{background:#fff;border-radius:16px;box-shadow:0 30px 80px rgba(3,10,30,.45),0 2px 6px rgba(3,10,30,.2)}
.field{border:1px solid #d7deea;border-radius:10px;padding:9px 12px;font-size:14px;background:#f8fafd}
.label{font-size:12px;font-weight:600;color:#5b6b85;margin:10px 0 4px}
.btn{display:inline-flex;justify-content:center;align-items:center;height:42px;border-radius:10px;font-weight:700;font-size:15px}
.btn-blue{background:linear-gradient(180deg,#3b82ff,#1463ff);color:#fff}
.btn-ghost{border:1px solid #d7deea;color:#0f1d33;background:#fff}
`;

function shell(w: number, h: number, inner: string, extraCss = "") {
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><style>${base}${extraCss}
  html,body{width:${w}px;height:${h}px;overflow:hidden;position:relative}</style></head><body><div class="bg"></div>
  <div class="glow" style="width:420px;height:420px;background:#3b82ff;right:-120px;top:-140px"></div>
  <div class="glow" style="width:360px;height:360px;background:#d9a441;left:-140px;bottom:-160px;opacity:.18"></div>
  ${inner}</body></html>`;
}

const headline = (kicker: string, title: string, sub: string) => `
  <div style="position:absolute;left:72px;top:96px;width:430px;color:#fff">
    <div class="brand" style="margin-bottom:34px">${icon}<span style="font-size:20px">EmlakSoft <span class="gold">İlan Kontrol</span></span></div>
    <div style="font-size:15px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#f6d27a;margin-bottom:14px">${kicker}</div>
    <div style="font-size:44px;line-height:1.12;font-weight:800;margin-bottom:20px">${title}</div>
    <div style="font-size:19px;line-height:1.5;color:#c9d6ee">${sub}</div>
  </div>`;

const popupForm = `
  <div class="card" style="width:360px;padding:18px 20px">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
      <div style="width:30px;height:30px;border-radius:8px;overflow:hidden">${icon}</div>
      <div style="font-weight:800;font-size:15px">İlan Kontrol</div>
    </div>
    <div style="font-weight:700;font-size:15px;margin-top:8px">EmlakSoft'a sahibinden ilan olarak kaydet</div>
    <div style="font-size:12.5px;color:#5b6b85;margin-top:2px">Açık olan bu ilanı ofis kaydınıza eklersiniz.</div>
    <div class="label">Başlık</div><div class="field">Kadıköy Moda'da 3+1 satılık daire</div>
    <div style="display:flex;gap:10px"><div style="flex:1"><div class="label">Fiyat (TL)</div><div class="field">12.450.000</div></div>
    <div style="width:110px"><div class="label">Brüt m²</div><div class="field">145</div></div></div>
    <div class="label">Konum</div><div class="field">İstanbul · Kadıköy · Caferağa</div>
    <div class="label">İlan sahibi adı (ilanda görünen)</div><div class="field">A*** Y***</div>
    <div style="display:flex;gap:8px;align-items:flex-start;margin-top:12px;font-size:12px;color:#33435c">
      <div style="width:16px;height:16px;border-radius:4px;background:#1463ff;flex:none;margin-top:1px"></div>
      Bu numarayı ilanda kendim gördüm ve ofis kaydına eklemek istiyorum.</div>
    <div class="btn btn-blue" style="width:100%;margin-top:14px">EmlakSoft'a kaydet</div>
  </div>`;

const listingPage = `
  <div class="card" style="position:absolute;left:560px;top:70px;width:660px;height:660px;overflow:hidden">
    <div style="height:42px;background:#eef2f8;display:flex;align-items:center;gap:8px;padding:0 14px;border-bottom:1px solid #dfe5ef">
      <span style="width:11px;height:11px;border-radius:50%;background:#ff5f57"></span><span style="width:11px;height:11px;border-radius:50%;background:#febc2e"></span><span style="width:11px;height:11px;border-radius:50%;background:#28c840"></span>
      <div style="margin-left:14px;flex:1;height:26px;border-radius:7px;background:#fff;font-size:12px;color:#6b7a92;display:flex;align-items:center;padding:0 10px">ilan sayfası · satılık daire</div>
      <div style="width:26px;height:26px;border-radius:7px;overflow:hidden;box-shadow:0 0 0 2px #3b82ff">${icon}</div>
    </div>
    <div style="padding:22px">
      <div style="height:230px;border-radius:12px;background:linear-gradient(135deg,#c9d8f0,#9db6dd);position:relative">
        <div style="position:absolute;left:18px;bottom:16px;background:rgba(7,26,56,.75);color:#fff;font-size:12px;padding:5px 10px;border-radius:999px">Sahibinden</div></div>
      <div style="font-size:21px;font-weight:800;margin-top:18px">Kadıköy Moda'da 3+1 satılık daire</div>
      <div style="font-size:24px;font-weight:800;color:#1463ff;margin-top:6px">12.450.000 TL</div>
      <div style="display:flex;gap:10px;margin-top:14px">${["3+1", "145 m²", "Kadıköy", "5. kat"].map((t) => `<span class="chip" style="background:#eef3fb;color:#33435c">${t}</span>`).join("")}</div>
      <div style="margin-top:18px;height:10px;width:92%;background:#e8edf5;border-radius:6px"></div>
      <div style="margin-top:10px;height:10px;width:78%;background:#e8edf5;border-radius:6px"></div>
      <div style="margin-top:10px;height:10px;width:85%;background:#e8edf5;border-radius:6px"></div>
    </div>
  </div>
  <div style="position:absolute;left:840px;top:118px">${popupForm}</div>`;

const shot1 = shell(1280, 800, headline("Tek tıkla kaydet", "Sahibinden ilanı saniyeler içinde portföy adayına çevirin", "Açtığınız ilanda eklentiye tıklayın; başlık, fiyat, m² ve konum okunur, siz kontrol edip EmlakSoft'a kaydedersiniz.") + listingPage);

const stat = (l: string, v: string, s = "") => `<div style="flex:1;background:#f4f7fc;border-radius:12px;padding:12px 14px"><div style="font-size:12px;color:#5b6b85;font-weight:600">${l}</div><div style="font-size:24px;font-weight:800;margin-top:2px">${v}</div>${s ? `<div style="font-size:11.5px;color:#6b7a92">${s}</div>` : ""}</div>`;
const row = (t: string, st: string, c: string) => `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #eef1f6;font-size:13.5px"><span>${t}</span><span class="chip" style="background:${c}1a;color:${c}">${st}</span></div>`;
const dash = `
  <div class="card" style="position:absolute;left:600px;top:80px;width:600px;padding:24px 26px">
    <div style="display:flex;align-items:center;justify-content:space-between">
      <div style="display:flex;align-items:center;gap:10px"><div style="width:32px;height:32px;border-radius:8px;overflow:hidden">${icon}</div><div style="font-weight:800;font-size:17px">İlan Kontrol</div></div>
      <span class="chip" style="background:#e7f8ef;color:#0f8a4b">● Bağlı · Kadıköy Ofis</span></div>
    <div style="display:flex;gap:12px;margin-top:18px">${stat("Bugün", "48", "kontrol edildi")}${stat("Son 7 gün", "312")}${stat("Sıradaki kontrol", "14:30")}</div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:18px"><div style="font-weight:700">Günlük tarama</div><div class="btn btn-blue" style="height:36px;padding:0 16px;font-size:14px">Şimdi tara</div></div>
    <div style="margin-top:14px;font-weight:700">Portal sağlığı</div>
    <div style="display:flex;gap:8px;margin-top:8px">${["sahibinden", "Hepsiemlak", "Emlakjet"].map((p) => `<span class="chip" style="background:#e7f8ef;color:#0f8a4b">● ${p}</span>`).join("")}</div>
    <div style="margin-top:16px;font-weight:700">Son sonuçlar</div>
    ${row("Şişli Mecidiyeköy kiralık dükkan", "Fiyat değişti", "#c27c0e")}
    ${row("Beşiktaş Levent 2+1 satılık", "Yayında", "#0f8a4b")}
    ${row("Üsküdar Acıbadem 3+1 satılık", "Yayından kalktı", "#d4343b")}
    ${row("Ataşehir Batı 1+1 kiralık", "Yayında", "#0f8a4b")}
  </div>`;
const shot2 = shell(1280, 800, headline("Günlük kontrol", "Portföyünüzdeki ilanlar her gün kendiliğinden kontrol edilir", "Fiyat değişikliği, yayından kalkan ilan ve portal sorunları tek bakışta. Tarama yalnız sizin tarayıcınızda ve düşük hızla çalışır.") + dash);

const lead = (t: string, meta: string, st: string, c: string, extra = "") => `<div style="border:1px solid #e6ebf3;border-radius:14px;padding:14px 16px;margin-top:10px">
  <div style="display:flex;justify-content:space-between;align-items:center"><div style="font-weight:700;font-size:15px">${t}</div><span class="chip" style="background:${c}1a;color:${c}">${st}</span></div>
  <div style="font-size:12.5px;color:#5b6b85;margin-top:4px">${meta}</div>${extra}</div>`;
const panel = `
  <div class="card" style="position:absolute;left:580px;top:70px;width:630px;padding:22px 24px">
    <div style="font-size:12px;font-weight:700;letter-spacing:.12em;color:#1463ff">PORTFÖY</div>
    <div style="font-size:24px;font-weight:800;margin-top:2px">Sahibinden ilanlar</div>
    <div style="display:flex;gap:10px;margin-top:14px">${stat("Yeni", "12")}${stat("Bugün aranacak", "7")}${stat("Yetki alındı", "3")}</div>
    ${lead("Kadıköy Moda 3+1 satılık", "12.450.000 TL · 145 m² · 2 gündür ilanda", "Bugün ara", "#1463ff", `<div style="display:flex;gap:8px;margin-top:10px"><span class="btn btn-blue" style="height:32px;padding:0 14px;font-size:13px">Ara</span><span class="btn btn-ghost" style="height:32px;padding:0 14px;font-size:13px">Not</span><span class="btn btn-ghost" style="height:32px;padding:0 14px;font-size:13px">Randevu</span></div>`)}
    ${lead("Beşiktaş Abbasağa 2+1 kiralık", "38.000 TL · fiyat %5 düştü", "Fiyat düştü", "#c27c0e")}
    ${lead("Ataşehir Barbaros 4+1 satılık", "Randevu: Perşembe 14:00", "Randevu", "#0f8a4b")}
  </div>`;
const shot3 = shell(1280, 800, headline("Takip ve dönüşüm", "Takip ritmiyle arayın, yetkiyi alın, portföye dönüştürün", "Kaydedilen ilanlar EmlakSoft'ta 0-3-7-14-21-30. gün hatırlatmalarıyla sıraya girer; fiyat düşüşü ve tekrar ilan kendiliğinden işaretlenir.") + panel);

const priv = (t: string, d: string) => `<div style="display:flex;gap:14px;align-items:flex-start;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);border-radius:16px;padding:18px 20px">
  <div style="width:34px;height:34px;border-radius:10px;background:linear-gradient(180deg,#f6d27a,#d9a441);flex:none;display:flex;align-items:center;justify-content:center;color:#071a38;font-weight:900">✓</div>
  <div><div style="font-weight:700;font-size:18px;color:#fff">${t}</div><div style="font-size:15px;color:#c9d6ee;margin-top:4px;line-height:1.45">${d}</div></div></div>`;
const shot4 = shell(1280, 800, headline("Gizlilik önce", "Yalnız siz tıkladığınızda, yalnız açık sekmede", "Eklenti arka planda veri toplamaz; okuduğu her şeyi kaydetmeden önce size gösterir.") + `
  <div style="position:absolute;left:600px;top:110px;width:600px;display:grid;gap:16px">
    ${priv("Kullanıcı eylemiyle okur", "İlan yalnız eklenti düğmesine bastığınızda ve yalnız açık sekmeden okunur.")}
    ${priv("Numarayı göster'e basmaz", "Telefon yalnız ilanda zaten görünüyorsa ve sizin onayınızla eklenir.")}
    ${priv("Toplu veri çekmez", "Sunucumuz portal sayfalarını hiç açmaz; kontrol sizin tarayıcınızda, düşük hızla yapılır.")}
    ${priv("Ofisinizde kalır", "Kayıtlar yalnız ofisinizin EmlakSoft hesabında tutulur; dönüşmeyen kişisel bilgiler süre sonunda silinir.")}
  </div>`);

const small = shell(440, 280, `
  <div style="position:absolute;inset:0;padding:28px 30px;color:#fff;display:flex;flex-direction:column;justify-content:center">
    <div style="width:64px;height:64px;border-radius:16px;overflow:hidden;margin-bottom:16px;box-shadow:0 10px 30px rgba(0,0,0,.35)">${icon}</div>
    <div style="font-size:30px;font-weight:800;line-height:1.1">EmlakSoft<br><span class="gold">İlan Kontrol</span></div>
    <div style="font-size:15px;color:#c9d6ee;margin-top:10px">Sahibinden ilanı tek tıkla kaydet,<br>portföyünü her gün kontrol et.</div>
  </div>`);

const marquee = shell(1400, 560, `
  <div style="position:absolute;left:90px;top:0;bottom:0;width:640px;display:flex;flex-direction:column;justify-content:center;color:#fff">
    <div class="brand" style="margin-bottom:26px">${icon}<span style="font-size:22px">EmlakSoft <span class="gold">İlan Kontrol</span></span></div>
    <div style="font-size:52px;font-weight:800;line-height:1.08">Sahibinden ilanı tek tıkla<br>portföy adayına çevirin</div>
    <div style="font-size:21px;color:#c9d6ee;margin-top:20px;line-height:1.45">Portföyünüzdeki ilanları her gün kontrol eder,<br>sahibinden ilanları EmlakSoft'a kaydeder.</div>
  </div>
  <div style="position:absolute;right:110px;top:62px;transform:scale(.92);transform-origin:top right">${popupForm}</div>`);

const jobs: [string, string, number, number][] = [
  ["ekran-1-tek-tikla-kaydet.png", shot1, 1280, 800],
  ["ekran-2-gunluk-kontrol.png", shot2, 1280, 800],
  ["ekran-3-takip-donusum.png", shot3, 1280, 800],
  ["ekran-4-gizlilik.png", shot4, 1280, 800],
  ["kucuk-tanitim-440x280.png", small, 440, 280],
  ["kayan-tanitim-1400x560.png", marquee, 1400, 560],
];

const browser = await chromium.launch();
try {
  for (const [name, html, w, h] of jobs) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: "load" });
    const buf = await page.screenshot({ type: "png" });
    await page.close();
    await sharp(buf).flatten({ background: "#071a38" }).removeAlpha().png({ compressionLevel: 9 }).toFile(`${OUT}/${name}`);
    const m = await sharp(`${OUT}/${name}`).metadata();
    console.log(name, m.width, m.height, "kanal:", m.channels, "alfa:", m.hasAlpha);
  }
} finally {
  await browser.close();
}
