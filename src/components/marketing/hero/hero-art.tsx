import type { CSSProperties } from "react";
import { AppShell, C, Card, Icon, Line, Pill, TONES, type Tone } from "../art/primitives";

/* Hero sahnesinin SVG parçaları. Sunucu bileşenleri; istemci JS yok. Tüm sayılar/isimler ÖRNEK veridir.
   Ana panel, gerçek /app ana ekranının v4 dilini taklit eder: KPI kartları (trend hapı), altın alan grafiği, Dikkat listesi. */

/** KPI kartı (v4): ikon karosu, etiket, büyük değer (sayaç katmanıyla aynı konum), trend hapı, alt metin. */
function KpiV4({ x, w, label, value, trend, sub, tone, icon }: { x: number; w: number; label: string; value: string; trend?: string; sub: string; tone: Tone; icon: number }) {
  const t = TONES[tone];
  return (
    <g transform={`translate(${x} 84)`}>
      <rect width={w} height={92} rx={14} fill="#fff" stroke={C.line} filter="url(#mkShadow)" />
      <rect x={14} y={14} width={28} height={28} rx={9} fill={t.bg} />
      <Icon i={icon} x={20} y={20} size={16} color={t.fg} />
      <text x={52} y={33} fontSize="13" fontWeight="600" fill={C.mute}>{label}</text>
      <text className="mk-kpi-v" x={16} y={70} fontSize="29" fontWeight="800" fill={C.ink}>{value}</text>
      {trend ? (
        <g transform={`translate(${w - 64} 52)`}>
          <rect width={52} height={22} rx={11} fill={TONES.green.bg} />
          <text x={26} y={15.5} textAnchor="middle" fontSize="11.5" fontWeight="700" fill={TONES.green.fg}>{trend}</text>
        </g>
      ) : null}
      <text x={16} y={86} fontSize="11" fill={C.mute}>{sub}</text>
    </g>
  );
}

/** Dikkat listesi satırı: önem düzeyi (Acil/Yüksek/Orta/Düşük) metin + renk, tek satır hedef. */
const ATTN: [string, string, string, Tone][] = [
  ["Kapanış formu bekliyor", "İlan yayından kalktı", "Acil", "red"],
  ["Teklife yanıt bekleniyor", "2 gündür dönüş yok", "Yüksek", "amber"],
  ["Yayın teyidi gecikti", "3 portföy", "Orta", "gold"],
  ["Randevu teyidi", "Yarın 10:00", "Düşük", "slate"],
];

export function HeroDashboard() {
  const months = ["Kas", "Ara", "Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki"];
  const vals = [62, 70, 66, 78, 84, 80, 96, 104, 112, 126, 142, 184];
  return (
    <AppShell w={900} h={560} sw={170} active={0} title="İyi günler, Ayşe" sub="2 iş dikkat bekliyor: en öncelikli olan bir kapanış formu." label="Örnek ekran: EmlakSoft ana ekranı; dört gösterge kartı, aylık komisyon alan grafiği ve önem sıralı Dikkat gerektirenler listesi">
      <KpiV4 x={194} w={166} label="Aktif portföy" value="38" trend="↗ %8" sub="3 teyit bekliyor" tone="blue" icon={2} />
      <KpiV4 x={372} w={166} label="Yeni talep" value="12" trend="↗ %20" sub="Bu hafta" tone="violet" icon={1} />
      <KpiV4 x={550} w={166} label="Komisyon" value="₺ 184 bin" sub="Bu ay" tone="gold" icon={5} />
      <KpiV4 x={728} w={160} label="Randevu" value="3" sub="İlki 10:00" tone="amber" icon={4} />

      <Card x={194} y={190} w={398} h={350} title="Aylık komisyon" right="Ayrıntı ↗">
        <text x={18} y={50} fontSize="12" fill={C.mute}>Son 12 ay · örnek veri</text>
        <text x={18} y={86} fontSize="26" fontWeight="800" fill={C.ink}>₺ 184 bin</text>
        <g transform="translate(150 68)">
          <rect width={56} height={22} rx={11} fill={TONES.green.bg} />
          <text x={28} y={15.5} textAnchor="middle" fontSize="11.5" fontWeight="700" fill={TONES.green.fg}>↗ %30</text>
        </g>
        {[0, 1, 2, 3].map((g) => <line key={g} x1={18} x2={380} y1={120 + g * 52} y2={120 + g * 52} stroke={C.line} strokeDasharray="3 5" />)}
        <Line x={18} y={112} w={362} h={176} vals={vals} min={40} color={C.gold} fill="url(#mkGold)" anim />
        <g transform="translate(318 104)">
          <rect width={64} height={24} rx={8} fill="#fff" stroke={C.line} />
          <text x={32} y={16.5} textAnchor="middle" fontSize="11.5" fontWeight="800" fill={C.goldText}>₺ 184 bin</text>
        </g>
        {months.map((m, i) => (
          <text key={m} x={18 + (362 / 11) * i} y={330} textAnchor="middle" fontSize="10.5" fill={C.mute}>{m}</text>
        ))}
      </Card>

      <Card x={604} y={190} w={284} h={350} title="Dikkat gerektirenler" right="4 iş">
        <text x={18} y={50} fontSize="12" fill={C.mute}>Önem sırasına göre</text>
        {ATTN.map(([title, sub, level, tone], i) => {
          const t = TONES[tone];
          return (
            <g key={title} transform={`translate(12 ${66 + i * 68})`}>
              <rect width={260} height={58} rx={12} fill={i === 0 ? "#fff6f6" : "#f8fafd"} stroke={C.line} />
              <circle cx={22} cy={29} r={11} fill={t.bg} />
              <text x={22} y={33.5} textAnchor="middle" fontSize="13" fontWeight="800" fill={t.fg}>{i === 0 ? "!" : i === 3 ? "i" : "•"}</text>
              <text x={42} y={25} fontSize="12.5" fontWeight="700" fill={C.ink}>{title}</text>
              <text x={42} y={42} fontSize="11" fill={C.mute}>{sub}</text>
              {i === 1 ? <Pill x={200} y={20} text="Çözüldü" tone="green" size={10.5} swap="from" delay="6.2s" /> : null}
              <Pill x={200} y={20} text={level} tone={tone} size={10.5} swap={i === 1 ? "to" : undefined} delay={i === 1 ? "6.2s" : undefined} />
            </g>
          );
        })}
      </Card>
    </AppShell>
  );
}

/**
 * KPI sayaç katmanı (HTML, aria-hidden). SVG <text> CSS sayaçla sayılamadığı için sayılar burada cqw ile konumlanır;
 * KPI SVG değerleri yalnız hareket açıkken gizlenir (data-motion="on"), reduce/JS'siz durumda SVG metni görünür (son kare).
 * Sayım: @property --mk-n (tamsayı) + CSS counter, JS yok. Koordinatlar HeroDashboard KPI kutularıyla aynı birimdedir (900 birim genişlik).
 */
export function HeroKpiOverlay() {
  const kpis: [number, number, string, string][] = [
    [210, 38, "", ""],
    [388, 12, "", ""],
    [566, 184, "₺ ", " bin"],
    [744, 3, "", ""],
  ];
  return (
    <div className="mk-dash-ov" aria-hidden="true">
      {kpis.map(([x, v, pre, suf], i) => (
        <b key={x} className="mk-ov-n" style={{ "--x": x, "--v": v, "--pre": `"${pre}"`, "--suf": `"${suf}"`, animationDelay: `${0.45 + i * 0.12}s` } as CSSProperties} />
      ))}
    </div>
  );
}

/** Telefon içeriği: müşteri listesi + randevular. Çerçeve CSS ile çizilir. */
export function HeroPhoneScreen() {
  const appts: [string, string, string, "blue" | "green" | "amber"][] = [
    ["10:00", "Yer gösterme", "Onaylandı", "green"],
    ["14:30", "Müşteri görüşmesi", "Onaylandı", "green"],
    ["16:00", "Sözleşme imzası", "Onaylandı", "green"],
  ];
  return (
    <svg className="mk-svg" viewBox="0 0 270 560" role="img" aria-label="Örnek ekran: mobil görünüm, günün randevuları ve hızlı işlemler" width="270" height="560">
      <defs>
        <linearGradient id="mkPh" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1d5cff" />
          <stop offset="1" stopColor="#0d2b5e" />
        </linearGradient>
      </defs>
      <rect width="270" height="560" fill="#f5f7fc" />
      <text x="20" y="42" fontSize="12" fontWeight="700" fill={C.ink}>9:41</text>
      <rect x="20" y="58" width="26" height="26" rx="8" fill="url(#mkPh)" />
      <text x="33" y="76" textAnchor="middle" fontSize="14" fontWeight="800" fill="#fff">E</text>
      <text x="54" y="77" fontSize="16" fontWeight="800" fill={C.ink}>EmlakSoft</text>
      <rect x="16" y="98" width="238" height="34" rx="10" fill="#fff" stroke={C.line} />
      <text x="30" y="120" fontSize="12.5" fill={C.mute}>Müşteri veya portföy ara…</text>
      {[["Müşteri", "#e6eeff", "#1546c2"], ["Portföy", "#e7ecf7", "#163a78"], ["Talep", "#dff5ee", "#0a6b57"], ["Randevu", "#fff0d2", "#8a5a00"]].map(([l, bg, fg], i) => (
        <g key={l} transform={`translate(${16 + i * 61} 146)`}>
          <rect width="52" height="48" rx="14" fill={bg} />
          <circle cx="26" cy="20" r="8" fill={fg} opacity="0.9" />
          <text x="26" y="62" textAnchor="middle" fontSize="11" fontWeight="600" fill={C.body}>{l}</text>
        </g>
      ))}
      <text x="16" y="238" fontSize="14" fontWeight="800" fill={C.ink}>Bugünün randevuları</text>
      {appts.map(([t, n, st, tone], i) => (
        <g key={t} transform={`translate(16 ${252 + i * 70})`}>
          <rect width="238" height="60" rx="14" fill="#fff" stroke={C.line} />
          <rect x="12" y="12" width="44" height="36" rx="10" fill="#eef3ff" />
          <text x="34" y="35" textAnchor="middle" fontSize="12" fontWeight="800" fill="#1546c2">{t}</text>
          <text x="68" y="28" fontSize="13" fontWeight="700" fill={C.ink}>{n}</text>
          {i === 1 ? <Pill x={68} y={34} text="Bekliyor" tone="amber" size={10.5} swap="from" delay="8.4s" /> : null}
          <Pill x={68} y={34} text={st} tone={tone} size={10.5} swap={i === 1 ? "to" : undefined} delay={i === 1 ? "8.4s" : undefined} />
        </g>
      ))}
      <text x="16" y="480" fontSize="14" fontWeight="800" fill={C.ink}>Hızlı işlemler</text>
      <rect x="16" y="492" width="112" height="36" rx="12" fill="url(#mkPh)" />
      <text x="72" y="515" textAnchor="middle" fontSize="12.5" fontWeight="700" fill="#fff">+ Yeni talep</text>
      <rect x="138" y="492" width="116" height="36" rx="12" fill="#fff" stroke={C.line} />
      <text x="196" y="515" textAnchor="middle" fontSize="12.5" fontWeight="700" fill={C.ink}>+ Randevu</text>
    </svg>
  );
}

/** Cam cepheli şehir silueti (el çizimi SVG; fotoğraf değil). */
export function HeroSkyline() {
  const blds: [number, number, number, number][] = [
    [30, 250, 70, 380], [108, 150, 86, 480], [204, 290, 64, 340], [278, 90, 96, 540], [384, 210, 74, 420],
    [468, 140, 90, 490], [568, 270, 70, 360], [648, 60, 100, 570], [758, 200, 60, 430],
  ];
  return (
    <svg className="mk-svg" viewBox="0 0 820 640" aria-hidden="true" focusable="false" preserveAspectRatio="xMidYMax slice">
      <defs>
        <linearGradient id="mkGlass" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#a9c2ff" stopOpacity="0.85" />
          <stop offset="1" stopColor="#dfe8fb" stopOpacity="0.7" />
        </linearGradient>
        <linearGradient id="mkFade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#f3f6ff" stopOpacity="0.7" />
        </linearGradient>
      </defs>
      {blds.map(([x, top, w, bottom], i) => (
        <g key={i} opacity={0.6 + (i % 3) * 0.2}>
          <rect x={x} y={top} width={w} height={bottom - top + 200} rx="4" fill="url(#mkGlass)" stroke="#6f93e6" strokeOpacity="0.55" />
          {Array.from({ length: Math.floor((bottom - top) / 26) }, (_, r) => (
            <line key={r} x1={x + 6} x2={x + w - 6} y1={top + 14 + r * 26} y2={top + 14 + r * 26} stroke="#fff" strokeOpacity="0.55" />
          ))}
          <line x1={x + w * 0.5} x2={x + w * 0.5} y1={top} y2={bottom + 200} stroke="#fff" strokeOpacity="0.35" />
        </g>
      ))}
      <rect width="820" height="640" fill="url(#mkFade)" />
    </svg>
  );
}
