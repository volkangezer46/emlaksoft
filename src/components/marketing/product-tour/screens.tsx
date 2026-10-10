import type { CSSProperties } from "react";
import { AppShell, Avatar, Bars, C, Card, Donut, Kpi, Line, Pill, TONES, type Tone } from "../art/primitives";

/* Ürün turu ekranları: saf SVG illüstrasyon, 1000x560. Veriler ÖRNEKTİR (jenerik isimler, uydurma müşteri yok). */
const W = 1000;
const H = 560;
const X0 = 214;

function Chips({ x, y, items, on = 0 }: { x: number; y: number; items: string[]; on?: number }) {
  const widths = items.map((t) => Math.round(t.length * 7.4 + 24));
  return (
    <g>
      {items.map((t, i) => {
        const w = widths[i];
        const cx = x + widths.slice(0, i).reduce((a, b) => a + b + 8, 0);
        return (
          <g key={t} transform={`translate(${cx} ${y})`}>
            <rect width={w} height={28} rx={14} fill={i === on ? C.ink : "#fff"} stroke={i === on ? C.ink : C.line} />
            <text x={w / 2} y={18.5} textAnchor="middle" fontSize="12.5" fontWeight="700" fill={i === on ? "#fff" : C.body}>{t}</text>
          </g>
        );
      })}
    </g>
  );
}

export function TodayScreen() {
  const tasks: [string, boolean][] = [["Teklif için müşteriyi ara", true], ["Portföy fotoğraflarını güncelle", false], ["Yayın teyidini yap", false], ["Sözleşme taslağını gönder", false], ["Kira artış bildirimini hazırla", true], ["Haftalık özeti incele", false]];
  const appts: [string, string, string, Tone][] = [["10:00", "Yer gösterme", "Onaylandı", "green"], ["14:30", "Müşteri görüşmesi", "Bekliyor", "amber"], ["16:00", "Sözleşme imzası", "Onaylandı", "green"]];
  const leads: [string, string, string][] = [["Ahmet K.", "3+1 daire arıyor", "3 eşleşme"], ["Zeynep D.", "Villa arıyor", "1 eşleşme"], ["Mehmet S.", "Kiralık 2+1", "5 eşleşme"]];
  return (
    <AppShell w={W} h={H} sw={190} active={0} title="Bugün" sub="6 görev · 3 randevu · yeni talepler" label="Bugün ekranı örneği: görev listesi, günün randevuları ve yeni talepler">
      <Card x={X0} y={84} w={380} h={456} title="Görevler" right="6 açık">
        {tasks.map(([t, d], i) => (
          <g key={t} transform={`translate(16 ${50 + i * 66})`}>
            <rect width="348" height="54" rx="12" fill={d ? "#f5f7fc" : "#fff"} stroke={C.line} />
            <rect x="14" y="17" width="20" height="20" rx="6" fill={d ? C.green : "#fff"} stroke={d ? C.green : "#b9c4dc"} strokeWidth="1.5" />
            {d ? <path className="mk-a-tick" pathLength={1} style={{ "--i": i } as CSSProperties} d="M19 27 l4 4 l8 -9" stroke="#fff" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" /> : null}
            <text x="46" y="32" fontSize="14" fontWeight="600" fill={d ? C.mute : C.ink} textDecoration={d ? "line-through" : undefined}>{t}</text>
          </g>
        ))}
      </Card>
      <Card x={606} y={84} w={370} h={246} title="Bugünün randevuları" right="Takvim">
        <line x1="76" x2="76" y1="52" y2="224" stroke="#d6dcea" strokeWidth="2" />
        {appts.map(([h, t, s, tone], i) => (
          <g key={h} transform={`translate(18 ${50 + i * 62})`}>
            <text x="0" y="30" fontSize="13.5" fontWeight="700" fill={C.mute}>{h}</text>
            <circle cx="58" cy="26" r="6.5" fill={i === 1 ? C.blue : "#9db6e8"} />
            <rect x="80" width="272" height="52" rx="12" fill={i === 1 ? "#eaf1ff" : "#f5f7fc"} />
            <text x="94" y="23" fontSize="14" fontWeight="700" fill={C.ink}>{t}</text>
            <Pill x={94} y={29} text={s} tone={tone} size={10.5} />
          </g>
        ))}
      </Card>
      <Card x={606} y={342} w={370} h={198} title="Yeni talepler" right="Tümü">
        {leads.map(([n, d, m], i) => (
          <g key={n} transform={`translate(18 ${50 + i * 48})`}>
            <Avatar x={16} y={18} r={15} text={n[0]} hue={i} />
            <text x="42" y="15" fontSize="13.5" fontWeight="700" fill={C.ink}>{n}</text>
            <text x="42" y="31" fontSize="12" fill={C.mute}>{d}</text>
            <Pill x={256} y={7} text={m} tone="blue" />
          </g>
        ))}
      </Card>
    </AppShell>
  );
}

export function CustomersScreen() {
  const rows: [string, string, string, Tone][] = [["Ahmet K.", "3+1 daire · bütçe 4–5 milyon", "Alıcı", "blue"], ["Zeynep D.", "Villa · deniz manzaralı", "Alıcı", "blue"], ["Mehmet S.", "Satılık 2+1 daire", "Satıcı", "violet"], ["Elif T.", "Kiralık 1+1", "Kiracı", "green"], ["Can B.", "Ticari dükkan", "Yatırımcı", "amber"], ["Selin A.", "Arsa · imarlı", "Satıcı", "violet"]];
  return (
    <AppShell w={W} h={H} sw={190} active={1} title="Müşteriler" sub="Müşteri, talep ve eşleşmeler aynı kartta" label="Müşteriler ekranı örneği: müşteri listesi ve seçili müşterinin talep ve eşleşme paneli" cta="+ Müşteri">
      <Card x={X0} y={84} w={450} h={456}>
        <Chips x={16} y={16} items={["Tümü", "Alıcılar", "Satıcılar", "Kiracılar"]} />
        {rows.map(([n, d, r, tone], i) => (
          <g key={n} transform={`translate(12 ${58 + i * 64})`}>
            <rect width="426" height="56" rx="12" fill={i === 1 ? "#eaf1ff" : "#fff"} stroke={i === 1 ? "#a9c1f5" : "transparent"} />
            <Avatar x={30} y={28} r={16} text={n[0]} hue={i} />
            <text x="58" y="25" fontSize="14" fontWeight="700" fill={C.ink}>{n}</text>
            <text x="58" y="42" fontSize="12" fill={C.mute}>{d}</text>
            <Pill x={344} y={16} text={r} tone={tone} />
          </g>
        ))}
      </Card>
      <Card x={676} y={84} w={300} h={456}>
        <Avatar x={150} y={58} r={30} text="Z" hue={1} />
        <text x="150" y="112" textAnchor="middle" fontSize="17" fontWeight="800" fill={C.ink}>Zeynep D.</text>
        <text x="150" y="132" textAnchor="middle" fontSize="12.5" fill={C.mute}>Alıcı · aktif talep</text>
        <Pill x={96} y={142} text="4 eşleşme" tone="green" />
        <rect x="96" y="174" width="108" height="5" rx="2.5" fill="#e3e8f2" />
        <rect className="mk-a-fillx" x="96" y="174" width="84" height="5" rx="2.5" fill={C.green} />
        {[["Talep", "Villa · satılık"], ["Bütçe", "8–10 milyon ₺"], ["Bölge", "Sahil hattı"], ["Son görüşme", "2 gün önce"], ["Sonraki adım", "Yer gösterme"]].map(([k, v], i) => (
          <g key={k} transform={`translate(20 ${190 + i * 50})`}>
            <rect width="260" height="42" rx="10" fill="#f5f7fc" />
            <text x="14" y="26" fontSize="12.5" fill={C.mute}>{k}</text>
            <text x="246" y="26" textAnchor="end" fontSize="13" fontWeight="700" fill={C.ink}>{v}</text>
          </g>
        ))}
      </Card>
    </AppShell>
  );
}

export function PortfolioScreen() {
  const items: [string, string, string, Tone][] = [["3+1 Daire · Kiralık", "Merkez", "Yayında", "green"], ["Villa · Satılık", "Sahil", "Yayında", "green"], ["2+1 Daire · Satılık", "Merkez", "Yayında", "green"], ["Arsa · İmarlı", "Çevre", "Yayında", "green"], ["Dükkan · Kiralık", "Çarşı", "Rezerve", "violet"], ["1+1 Daire · Kiralık", "Merkez", "Yayında", "green"]];
  const grads = ["#dbe8ff", "#e9defd", "#d6f3ea", "#ffe9c9", "#ffdfe2", "#dfe9fb"];
  return (
    <AppShell w={W} h={H} sw={190} active={2} title="Portföy" sub="Portföyler, yayın teyidi ve anahtar takibi" label="Portföy ekranı örneği: durum etiketli portföy kartları" cta="+ Portföy">
      <Chips x={X0} y={78} items={["Tümü", "Satılıklar", "Kiralıklar", "Teyit bekleyen"]} />
      {items.map(([t, loc, st, tone], i) => {
        const x = X0 + (i % 3) * 258;
        const y = 120 + Math.floor(i / 3) * 214;
        return (
          <g key={t + i} transform={`translate(${x} ${y})`}>
            <rect width="246" height="202" rx="16" fill="#fff" stroke={C.line} filter="url(#mkShadow)" />
            <rect x="10" y="10" width="226" height="108" rx="11" fill={grads[i]} />
            <path d="M82 100 V66 L123 40 L164 66 V100 Z M111 100 V78 H135 V100" fill="none" stroke="#2a3d78" strokeOpacity="0.55" strokeWidth="2.5" strokeLinejoin="round" />
            {i === 2 ? (
              <g className="mk-a-swap-from" style={{ animationDelay: "1.4s" }}>
                <rect x="20" y="20" width="98" height="22" rx="11" fill={TONES.amber.bg} />
                <text x="69" y="35" textAnchor="middle" fontSize="11" fontWeight="800" fill={TONES.amber.fg}>Teyit bekliyor</text>
              </g>
            ) : null}
            <g className={i === 2 ? "mk-a-swap-to" : undefined} style={i === 2 ? { animationDelay: "1.4s" } : undefined}>
              <rect x="20" y="20" width="70" height="22" rx="11" fill={TONES[tone].bg} />
              <text x="55" y="35" textAnchor="middle" fontSize="11" fontWeight="800" fill={TONES[tone].fg}>{st}</text>
            </g>
            <text x="16" y="146" fontSize="14" fontWeight="800" fill={C.ink}>{t}</text>
            <text x="16" y="166" fontSize="12.5" fill={C.mute}>{loc}</text>
            <text x="16" y="188" fontSize="13" fontWeight="800" fill={C.blue}>{["₺ 38.000 / ay", "₺ 12.400.000", "₺ 3.850.000", "₺ 2.100.000", "₺ 65.000 / ay", "₺ 24.000 / ay"][i]}</text>
          </g>
        );
      })}
    </AppShell>
  );
}

export function DealsScreen() {
  const cols: [string, string, [string, string, string][]][] = [
    ["Teklif", C.blue, [["3+1 Daire", "Ahmet K. → Mehmet S.", "₺ 4,2 mn"], ["Villa", "Zeynep D.", "₺ 11 mn"], ["Dükkan", "Can B.", "₺ 6,5 mn"]]],
    ["Sözleşme", "#163a78", [["2+1 Daire", "Elif T.", "₺ 3,6 mn"], ["Arsa", "Selin A.", "₺ 2,4 mn"]]],
    ["İmza", "#e5a23a", [["1+1 Daire", "Kiralama", "₺ 24 bin/ay"]]],
    ["Tamamlandı", C.green, [["3+1 Daire", "Tapu devri yapıldı", "₺ 4,8 mn"], ["Dükkan", "Komisyon kesildi", "₺ 5,1 mn"]]],
  ];
  return (
    <AppShell w={W} h={H} sw={190} active={3} title="Anlaşmalar" sub="Tekliften tamamlanmaya aşamalara göre" label="Anlaşmalar ekranı örneği: aşamalara göre kanban sütunları" cta="+ Anlaşma">
      {cols.map(([t, c, cards], i) => (
        <g key={t} transform={`translate(${X0 + i * 192} 84)`}>
          <rect width="182" height="456" rx="14" fill="#eaeef8" />
          <circle cx="20" cy="26" r="6" fill={c} />
          <text x="34" y="31" fontSize="14" fontWeight="800" fill={C.ink}>{t}</text>
          <text x="166" y="31" textAnchor="end" fontSize="12.5" fontWeight="700" fill={C.mute}>{cards.length}</text>
          {cards.map(([a, b, p], k) => (
            <g key={a + k} transform={`translate(10 ${50 + k * 118})`}>
              <g className={i === 1 && k === 0 ? "mk-a-slide" : undefined}>
              <rect width="162" height="108" rx="12" fill="#fff" stroke={C.line} filter="url(#mkShadow)" />
              <rect x="0" y="14" width="3.5" height="26" rx="2" fill={c} />
              <text x="14" y="30" fontSize="13.5" fontWeight="800" fill={C.ink}>{a}</text>
              <text x="14" y="50" fontSize="11.5" fill={C.mute}>{b}</text>
              <text x="14" y="78" fontSize="14" fontWeight="800" fill={C.blue}>{p}</text>
              <Avatar x={138} y={86} r={12} text={a[0]} hue={k + i} />
              <rect x="14" y="90" width="70" height="6" rx="3" fill="#e3e8f2" />
              <rect x="14" y="90" width={28 + ((k + i) % 3) * 16} height="6" rx="3" fill={c} />
              </g>
            </g>
          ))}
        </g>
      ))}
    </AppShell>
  );
}

export function CommissionScreen() {
  const rows: [string, string, string, string, Tone][] = [["3+1 Daire · satış", "Ahmet K.", "₺ 96.000", "Hakediş", "green"], ["Villa · satış", "Zeynep D.", "₺ 220.000", "Bekliyor", "amber"], ["Dükkan · kiralama", "Can B.", "₺ 32.500", "Hakediş", "green"], ["2+1 Daire · satış", "Elif T.", "₺ 72.000", "Onay bekliyor", "violet"], ["Arsa · satış", "Selin A.", "₺ 48.000", "Hakediş", "green"]];
  return (
    <AppShell w={W} h={H} sw={190} active={5} title="Komisyon" sub="Bölüşüm, hakediş ve onay durumu" label="Komisyon ekranı örneği: komisyon kayıtları, hakediş durumları ve aylık dağılım grafiği" cta="+ Kayıt">
      <Kpi x={X0} y={84} w={246} label="Bu ay toplam" value="₺ 468 bin" delta="" tone="green" icon={5} />
      <Kpi x={474} y={84} w={246} label="Onay bekleyen" value="₺ 292 bin" delta="2 kayıt" tone="amber" icon={3} />
      <Kpi x={734} y={84} w={242} label="Ofis payı" value="%40" delta="varsayılan" tone="blue" icon={6} />
      <Card x={X0} y={188} w={470} h={352} title="Komisyon kayıtları" right="Tümü">
        {rows.map(([a, b, p, s, tone], i) => (
          <g key={a} transform={`translate(14 ${46 + i * 60})`}>
            <rect width="442" height="52" rx="11" fill={i % 2 ? "#fff" : "#f7f9fd"} />
            <text x="14" y="22" fontSize="13.5" fontWeight="700" fill={C.ink}>{a}</text>
            <text x="14" y="39" fontSize="12" fill={C.mute}>{b}</text>
            <text x="262" y="31" textAnchor="end" fontSize="13.5" fontWeight="800" fill={C.ink}>{p}</text>
            <Pill x={300} y={14} text={s} tone={tone} />
          </g>
        ))}
      </Card>
      <Card x={696} y={188} w={280} h={352} title="Aylık dağılım" right="6 ay">
        <Bars x={22} y={70} w={236} h={210} vals={[46, 70, 54, 88, 66, 104]} hl={5} anim labels={["Nis", "May", "Haz", "Tem", "Ağu", "Eyl"]} />
      </Card>
    </AppShell>
  );
}

export function ReportsScreen() {
  const funnel: [string, number][] = [["Talep", 100], ["Yer gösterme", 68], ["Teklif", 41], ["Anlaşma", 22]];
  const team: [string, number][] = [["Danışman A", 92], ["Danışman B", 74], ["Danışman C", 58], ["Danışman D", 41]];
  return (
    <AppShell w={W} h={H} sw={190} active={6} title="Raporlar" sub="Satış hunisi, danışman karnesi, kayıp-kaçak" label="Raporlar ekranı örneği: satış hunisi, danışman karnesi ve kayıp-kaçak özeti" cta="Dışa aktar">
      <Card x={X0} y={84} w={380} h={226} title="Satış hunisi" right="Son 30 gün">
        {funnel.map(([t, v], i) => (
          <g key={t} transform={`translate(18 ${50 + i * 42})`}>
            <text x="0" y="22" fontSize="12.5" fontWeight="600" fill={C.body}>{t}</text>
            <rect x="104" y="4" width="240" height="26" rx="8" fill="#eef2fb" />
            <rect className="mk-a-fillx" style={{ "--i": i } as CSSProperties} x="104" y="4" width={(240 * v) / 100} height="26" rx="8" fill="url(#mkBrand)" opacity={1 - i * 0.14} />
            <text x={104 + (240 * v) / 100 - 10} y="22" textAnchor="end" fontSize="12" fontWeight="800" fill="#fff">%{v}</text>
          </g>
        ))}
      </Card>
      <Card x={606} y={84} w={370} h={226} title="Danışman karnesi" right="Ekip ligi">
        {team.map(([n, v], i) => (
          <g key={n} transform={`translate(18 ${50 + i * 42})`}>
            <Avatar x={14} y={14} r={13} text={n[n.length - 1]} hue={i} />
            <text x="38" y="19" fontSize="13" fontWeight="700" fill={C.ink}>{n}</text>
            <rect x="140" y="6" width="190" height="16" rx="8" fill="#eef2fb" />
            <rect className="mk-a-fillx" style={{ "--i": i } as CSSProperties} x="140" y="6" width={(190 * v) / 100} height="16" rx="8" fill={i === 0 ? C.green : "#6c8fe8"} />
          </g>
        ))}
      </Card>
      <Card x={X0} y={322} w={380} h={218} title="Yeni müşteri trendi" right="9 ay">
        <Line x={20} y={54} w={340} h={130} vals={[20, 26, 24, 33, 38, 36, 47, 52, 61]} />
      </Card>
      <Card x={606} y={322} w={370} h={218} title="Kayıp-kaçak özeti" right="Örnek">
        <Donut cx={96} cy={128} r={48} parts={[[11, "#e5484d"], [5, "#e5a23a"], [26, "#d6dcea"]]} center="16" sub="kapanış" />
        {[["Rakibe gitti", "#e5484d", "11"], ["Sahibi vazgeçti", "#e5a23a", "5"], ["Diğer", "#c9d2e6", "26"]].map(([l, c, v], i) => (
          <g key={l} transform={`translate(176 ${92 + i * 30})`}>
            <circle cx="0" cy="-4" r="5" fill={c} />
            <text x="14" y="0" fontSize="13" fill={C.body}>{l}</text>
            <text x="176" y="0" textAnchor="end" fontSize="13" fontWeight="800" fill={C.ink}>{v}</text>
          </g>
        ))}
      </Card>
    </AppShell>
  );
}

export function AutomationScreen() {
  const jobs: [string, string, boolean][] = [["Görev hatırlatma", "Her sabah · açık görevler", true], ["Randevu hatırlatma", "Randevudan önce", true], ["Portal teyit", "İlan numarası için periyodik", true], ["Günlük ve haftalık özet", "Sabah / pazartesi", true], ["Kira tahakkuku", "Ay başı", true], ["Anahtar gecikme uyarısı", "Teslim süresi aşılınca", false]];
  const log: [string, string][] = [["07:30", "Görev hatırlatma gönderildi"], ["08:00", "Günlük özet hazırlandı"], ["09:15", "Portal teyidi istendi"], ["12:00", "Randevu hatırlatması iletildi"]];
  return (
    <AppShell w={W} h={H} sw={190} active={7} title="Otomasyonlar" sub="Arka planda çalışan zamanlanmış görevler" label="Otomasyon ekranı örneği: zamanlanmış görevler ve son çalışma kayıtları" cta="+ Kural">
      <Card x={X0} y={84} w={440} h={456} title="Zamanlanmış görevler" right="27 görev">
        {jobs.map(([t, d, on], i) => (
          <g key={t} transform={`translate(14 ${48 + i * 66})`}>
            <rect width="412" height="56" rx="12" fill="#f7f9fd" stroke={C.line} />
            <rect x="12" y="12" width="32" height="32" rx="10" fill={on ? "#e6eeff" : "#eef1f7"} />
            <circle cx="28" cy="28" r="7" fill="none" stroke={on ? C.blue : "#9aa6bf"} strokeWidth="2.2" />
            <path d="M28 23 V28 L31 30" stroke={on ? C.blue : "#9aa6bf"} strokeWidth="2" fill="none" strokeLinecap="round" />
            <text x="56" y="25" fontSize="13.5" fontWeight="700" fill={C.ink}>{t}</text>
            <text x="56" y="42" fontSize="12" fill={C.mute}>{d}</text>
            <rect x="354" y="16" width="44" height="24" rx="12" fill={on ? C.blue : "#cdd5e6"} />
            <circle cx={on ? 386 : 366} cy="28" r="9" fill="#fff" />
          </g>
        ))}
      </Card>
      <Card x={676} y={84} w={300} h={456} title="Son çalışmalar" right="Bugün">
        <line x1="44" x2="44" y1="58" y2="330" stroke="#d6dcea" strokeWidth="2" />
        {log.map(([t, d], i) => (
          <g key={t} transform={`translate(18 ${56 + i * 70})`}>
            <text x="0" y="22" fontSize="12.5" fontWeight="700" fill={C.mute}>{t}</text>
            <circle className="mk-a-pop" style={{ "--i": i } as CSSProperties} cx="26" cy="18" r="6" fill={C.green} />
            <text x="46" y="16" fontSize="13" fontWeight="700" fill={C.ink}>{d}</text>
            <Pill x={46} y={26} text="Başarılı" tone="green" size={10.5} />
          </g>
        ))}
        <rect x="18" y="360" width="264" height="74" rx="12" fill="#eef3ff" />
        <text x="32" y="386" fontSize="12.5" fontWeight="800" fill="#1546c2">Görev çalışmaları kayıt altına</text>
        <text x="32" y="406" fontSize="12" fill={C.body}>alınır; ne zaman ve hangi görevin</text>
        <text x="32" y="422" fontSize="12" fill={C.body}>çalıştığını izlersiniz.</text>
      </Card>
    </AppShell>
  );
}
