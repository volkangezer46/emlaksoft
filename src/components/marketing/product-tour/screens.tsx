import type { ReactNode } from "react";

/* Ürün turu ekranları: saf SVG illüstrasyon. Veriler ÖRNEKTİR (jenerik isimler, uydurma müşteri yok). */
const INK = "#071a38";
const LINE = "#e6eaf2";

function Shell({ title, active, label, children }: { title: string; active: number; label: string; children: ReactNode }) {
  return (
    <svg className="mk-svg" viewBox="0 0 1000 520" role="img" aria-label={label} width="1000" height="520">
      <rect width="1000" height="520" fill="#f6f8fc" />
      <rect width="64" height="520" fill={INK} />
      {[0, 1, 2, 3, 4].map((i) => (
        <rect key={i} x="20" y={28 + i * 52} width="24" height="24" rx="7" fill={i === active ? "#1463ff" : "#27406b"} />
      ))}
      <text x="96" y="52" className="mk-m" fontSize="24" fontWeight="700" fill={INK}>{title}</text>
      {children}
    </svg>
  );
}

function Card({ x, y, w, h, title, children }: { x: number; y: number; w: number; h: number; title?: string; children?: ReactNode }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect width={w} height={h} rx="14" fill="#fff" stroke={LINE} />
      {title ? <text x="20" y="32" fontSize="15" fontWeight="700" fill={INK}>{title}</text> : null}
      {children}
    </g>
  );
}

export function TodayScreen() {
  const tasks = [["Teklif için müşteriyi ara", true], ["Portföy fotoğraflarını güncelle", false], ["Yayın teyidini yap", false], ["Sözleşme taslağını gönder", false], ["Hatırlatma: kira artışı", true]] as const;
  const appts = [["10:00", "Yer gösterme"], ["12:30", "Müşteri görüşmesi"], ["14:30", "Yer gösterme"], ["16:00", "Sözleşme imzası"]];
  return (
    <Shell title="Bugün" active={0} label="Bugün ekranı örneği: görev listesi ve gün içi randevular">
      <Card x={96} y={84} w={440} h={400} title="Görevler">
        {tasks.map(([t, d], i) => (
          <g key={t} transform={`translate(20 ${58 + i * 64})`}>
            <rect width="400" height="50" rx="10" fill="#f6f8fc" />
            <rect x="14" y="15" width="20" height="20" rx="6" fill={d ? "#0e9f8c" : "#fff"} stroke={d ? "#0e9f8c" : "#c4cfe3"} />
            {d ? <path d="M19 25 l4 4 l8 -9" stroke="#fff" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" /> : null}
            <text x="48" y="31" fontSize="14" fontWeight="500" fill={d ? "#667085" : INK} textDecoration={d ? "line-through" : undefined}>{t}</text>
          </g>
        ))}
      </Card>
      <Card x={560} y={84} w={400} h={400} title="Bugünün randevuları">
        <line x1="86" x2="86" y1="60" y2="370" stroke="#d6dcea" strokeWidth="2" />
        {appts.map(([h, t], i) => (
          <g key={h} transform={`translate(20 ${58 + i * 78})`}>
            <text x="0" y="28" fontSize="14" fontWeight="600" className="mk-m" fill="#5b6577">{h}</text>
            <circle cx="66" cy="24" r="7" fill={i === 2 ? "#1463ff" : "#9db6e8"} />
            <rect x="92" width="270" height="50" rx="12" fill={i === 2 ? "#eaf1ff" : "#f6f8fc"} />
            <text x="110" y="31" fontSize="14" fontWeight="600" fill={INK}>{t}</text>
          </g>
        ))}
      </Card>
    </Shell>
  );
}

export function CustomersScreen() {
  const rows = ["Müşteri A", "Müşteri B", "Müşteri C", "Müşteri D", "Müşteri E", "Müşteri F"];
  return (
    <Shell title="Müşteriler" active={1} label="Müşteriler ekranı örneği: müşteri listesi ve seçili müşteri paneli">
      <Card x={96} y={84} w={520} h={400}>
        {rows.map((r, i) => (
          <g key={r} transform={`translate(16 ${16 + i * 62})`}>
            <rect width="488" height="52" rx="10" fill={i === 1 ? "#eaf1ff" : "#fff"} stroke={i === 1 ? "#9db6e8" : LINE} />
            <circle cx="28" cy="26" r="14" fill="#dbe7ff" />
            <text x="54" y="22" fontSize="14" fontWeight="600" fill={INK}>{r}</text>
            <rect x="54" y="30" width={110 + (i % 3) * 30} height="8" rx="4" fill="#e6eaf2" />
            <rect x="388" y="16" width="84" height="22" rx="11" fill={i % 2 ? "#e3f6f2" : "#e9eefc"} />
            <text x="430" y="31" textAnchor="middle" fontSize="12" fontWeight="600" fill={i % 2 ? "#0b8172" : "#0b4fd6"}>{i % 2 ? "Alıcı" : "Satıcı"}</text>
          </g>
        ))}
      </Card>
      <Card x={640} y={84} w={320} h={400}>
        <circle cx="160" cy="70" r="34" fill="#dbe7ff" />
        <text x="160" y="140" textAnchor="middle" fontSize="18" fontWeight="700" className="mk-m" fill={INK}>Müşteri B</text>
        <text x="160" y="162" textAnchor="middle" fontSize="13" fill="#5b6577">Alıcı · aktif talep</text>
        {["Talep: 3+1 daire", "Eşleşen portföy", "Son görüşme notu", "Sonraki adım"].map((t, i) => (
          <g key={t} transform={`translate(24 ${190 + i * 48})`}>
            <rect width="272" height="38" rx="10" fill="#f6f8fc" />
            <text x="14" y="24" fontSize="13" fontWeight="500" fill={INK}>{t}</text>
          </g>
        ))}
      </Card>
    </Shell>
  );
}

export function PortfolioScreen() {
  return (
    <Shell title="Portföy" active={2} label="Portföy ekranı örneği: kroki ikonlu portföy kartları">
      {[0, 1, 2, 3, 4, 5].map((i) => {
        const x = 96 + (i % 3) * 292;
        const y = 84 + Math.floor(i / 3) * 204;
        return (
          <g key={i} transform={`translate(${x} ${y})`}>
            <rect width="272" height="188" rx="14" fill="#fff" stroke={LINE} />
            <rect x="12" y="12" width="248" height="96" rx="10" fill={["#e6efff", "#e3f6f2", "#fdf3de"][i % 3]} />
            <path d="M96 88 V58 L136 34 L176 58 V88 Z M126 88 V68 H146 V88" fill="none" stroke="#0a2247" strokeOpacity="0.55" strokeWidth="2.5" strokeLinejoin="round" />
            <rect x="16" y="124" width="150" height="10" rx="5" fill={INK} opacity="0.85" />
            <rect x="16" y="144" width="100" height="8" rx="4" fill="#d6dcea" />
            <rect x="176" y="140" width="80" height="24" rx="12" fill={i === 2 ? "#fdf3de" : "#e3f6f2"} />
            <text x="216" y="156" textAnchor="middle" fontSize="12" fontWeight="600" fill={i === 2 ? "#8f6a24" : "#0b8172"}>{i === 2 ? "Teyit bekliyor" : "Yayında"}</text>
          </g>
        );
      })}
    </Shell>
  );
}

export function DealsScreen() {
  const cols = [["Teklif", 3, "#1463ff"], ["Sözleşme", 2, "#0e9f8c"], ["İmza", 2, "#e0a53a"], ["Tamamlandı", 1, "#667085"]] as const;
  return (
    <Shell title="Anlaşmalar" active={3} label="Anlaşmalar ekranı örneği: aşamalara göre kanban sütunları">
      {cols.map(([t, n, c], i) => (
        <g key={t} transform={`translate(${96 + i * 220} 84)`}>
          <rect width="204" height="400" rx="14" fill="#eef1f8" />
          <circle cx="22" cy="30" r="6" fill={c} />
          <text x="36" y="35" fontSize="14" fontWeight="700" fill={INK}>{t}</text>
          {Array.from({ length: n }, (_, k) => (
            <g key={k} transform={`translate(12 ${58 + k * 108})`}>
              <rect width="180" height="96" rx="12" fill="#fff" stroke={LINE} />
              <rect x="14" y="16" width="110" height="10" rx="5" fill={INK} opacity="0.85" />
              <rect x="14" y="36" width="76" height="8" rx="4" fill="#d6dcea" />
              <rect x="14" y="62" width="64" height="20" rx="10" fill={c} opacity="0.16" />
            </g>
          ))}
        </g>
      ))}
    </Shell>
  );
}

export function FinanceScreen() {
  const bars = [44, 70, 52, 88, 66, 104];
  return (
    <Shell title="Finans" active={4} label="Finans ekranı örneği: komisyon tablosu ve çubuk grafik">
      <Card x={96} y={84} w={500} h={400} title="Komisyon kayıtları">
        {[0, 1, 2, 3, 4].map((i) => (
          <g key={i} transform={`translate(20 ${54 + i * 66})`}>
            <rect width="460" height="54" rx="10" fill={i % 2 ? "#fff" : "#f6f8fc"} />
            <rect x="16" y="16" width="130" height="10" rx="5" fill={INK} opacity="0.85" />
            <rect x="16" y="34" width="80" height="8" rx="4" fill="#d6dcea" />
            <rect x="214" y="22" width="90" height="10" rx="5" fill="#9db6e8" />
            <rect x="348" y="16" width="96" height="24" rx="12" fill={i === 1 ? "#fdf3de" : "#e3f6f2"} />
            <text x="396" y="32" textAnchor="middle" fontSize="12" fontWeight="600" fill={i === 1 ? "#8f6a24" : "#0b8172"}>{i === 1 ? "Bekliyor" : "Hakediş"}</text>
          </g>
        ))}
      </Card>
      <Card x={620} y={84} w={340} h={400} title="Aylık dağılım">
        {bars.map((h, i) => (
          <g key={i}>
            <rect x={28 + i * 48} y={330 - h * 2.2} width="30" height={h * 2.2} rx="6" fill="#1463ff" opacity="0.9" />
            <rect x={28 + i * 48} y={330 - h * 2.2 - Math.round(h * 0.5)} width="30" height={Math.round(h * 0.5)} rx="6" fill="#0e9f8c" />
          </g>
        ))}
        <line x1="20" x2="320" y1="334" y2="334" stroke={LINE} />
      </Card>
    </Shell>
  );
}
