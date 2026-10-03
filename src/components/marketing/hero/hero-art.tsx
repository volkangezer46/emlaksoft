import { AppShell, Avatar, Bars, C, Card, Donut, Kpi, Line, Pill } from "../art/primitives";

/* Hero sahnesinin SVG parçaları. Sunucu bileşenleri; istemci JS yok. Tüm sayılar/isimler ÖRNEK veridir. */

export function HeroDashboard() {
  const rows: [string, string, string, string, "blue" | "green" | "amber"][] = [
    ["Ahmet K.", "3+1 daire · kiralık", "Yer gösterme", "Bugün 14:30", "blue"],
    ["Zeynep D.", "Villa · satılık", "Teklif bekliyor", "Yarın", "amber"],
    ["Mehmet S.", "2+1 daire · satılık", "Eşleşti", "2 portföy", "green"],
  ];
  return (
    <AppShell w={900} h={560} sw={170} active={0} title="Günaydın" sub="Bugün 6 göreviniz, 3 randevunuz ve yeni talepleriniz var." label="Örnek ekran: EmlakSoft ana ekranı; göstergeler, aylık performans grafiği, dağılım halkası ve son talepler">
      <Kpi x={194} y={84} w={166} label="Yeni talep" value="12" delta="bu hafta" tone="blue" icon={1} />
      <Kpi x={372} y={84} w={166} label="Aktif portföy" value="38" delta="3 teyit bekliyor" tone="violet" icon={2} />
      <Kpi x={550} y={84} w={166} label="Komisyon" value="₺ 184 bin" delta="" tone="green" icon={5} />
      <Kpi x={728} y={84} w={160} label="Randevu" value="3" delta="ilki 10:00" tone="amber" icon={4} />
      <Card x={194} y={190} w={380} h={206} title="Aylık performans" right="Son 9 ay">
        <Line x={20} y={52} w={340} h={110} vals={[30, 38, 34, 46, 52, 49, 62, 70, 84]} />
        <Bars x={20} y={52} w={340} h={110} vals={[18, 26, 22, 30, 34, 31, 40, 44, 52]} hl={8} />
        {["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl"].map((m, i) => (
          <text key={m} x={20 + (340 / 9) * i + 340 / 18} y={186} textAnchor="middle" fontSize="11" fill={C.mute}>{m}</text>
        ))}
      </Card>
      <Card x={586} y={190} w={302} h={206} title="Portföy dağılımı">
        <Donut cx={86} cy={118} r={46} parts={[[16, "#1d5cff"], [9, "#7a3cf0"], [7, "#0e9f7e"], [6, "#e5a23a"]]} center="38" sub="portföy" />
        {[["Konut", "#1d5cff", "16"], ["Arsa", "#7a3cf0", "9"], ["Ticari", "#0e9f7e", "7"], ["Diğer", "#e5a23a", "6"]].map(([l, c, v], i) => (
          <g key={l} transform={`translate(160 ${70 + i * 26})`}>
            <circle r="5" cx="0" cy="-4" fill={c} />
            <text x="14" y="0" fontSize="13" fill={C.body}>{l}</text>
            <text x="126" y="0" textAnchor="end" fontSize="13" fontWeight="700" fill={C.ink}>{v}</text>
          </g>
        ))}
      </Card>
      <Card x={194} y={408} w={694} h={134} title="Son talepler" right="Tümünü gör">
        {rows.map(([n, d, st, when, tone], i) => (
          <g key={n} transform={`translate(18 ${44 + i * 30})`}>
            <Avatar x={14} y={10} r={12} text={n[0]} hue={i} />
            <text x={36} y={8} fontSize="13" fontWeight="700" fill={C.ink}>{n}</text>
            <text x={36} y={22} fontSize="11.5" fill={C.mute}>{d}</text>
            <Pill x={300} y={-3} text={st} tone={tone} />
            <text x={658} y={14} textAnchor="end" fontSize="12.5" fill={C.body}>{when}</text>
          </g>
        ))}
      </Card>
    </AppShell>
  );
}

/** Telefon içeriği: müşteri listesi + randevular. Çerçeve CSS ile çizilir. */
export function HeroPhoneScreen() {
  const appts: [string, string, string, "blue" | "green" | "amber"][] = [
    ["10:00", "Yer gösterme", "Onaylandı", "green"],
    ["14:30", "Müşteri görüşmesi", "Bekliyor", "amber"],
    ["16:00", "Sözleşme imzası", "Onaylandı", "green"],
  ];
  return (
    <svg className="mk-svg" viewBox="0 0 270 560" role="img" aria-label="Örnek ekran: mobil görünüm, günün randevuları ve hızlı işlemler" width="270" height="560">
      <defs>
        <linearGradient id="mkPh" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1d5cff" />
          <stop offset="1" stopColor="#7a3cf0" />
        </linearGradient>
      </defs>
      <rect width="270" height="560" fill="#f5f7fc" />
      <text x="20" y="42" fontSize="12" fontWeight="700" fill={C.ink}>9:41</text>
      <rect x="20" y="58" width="26" height="26" rx="8" fill="url(#mkPh)" />
      <text x="33" y="76" textAnchor="middle" fontSize="14" fontWeight="800" fill="#fff">E</text>
      <text x="54" y="77" fontSize="16" fontWeight="800" fill={C.ink}>EmlakSoft</text>
      <rect x="16" y="98" width="238" height="34" rx="10" fill="#fff" stroke={C.line} />
      <text x="30" y="120" fontSize="12.5" fill={C.mute}>Müşteri veya portföy ara…</text>
      {[["Müşteri", "#e6eeff", "#1546c2"], ["Portföy", "#efe6ff", "#5b2fc4"], ["Talep", "#dff5ee", "#0a6b57"], ["Randevu", "#fff0d2", "#8a5a00"]].map(([l, bg, fg], i) => (
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
          <Pill x={68} y={34} text={st} tone={tone} size={10.5} />
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
          <stop offset="0" stopColor="#8fb2ff" stopOpacity="0.9" />
          <stop offset="1" stopColor="#cdbcff" stopOpacity="0.7" />
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
