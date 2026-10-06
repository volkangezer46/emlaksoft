import type { CSSProperties } from "react";
import type { FeaturedPreviewKind } from "@/lib/site-menu/schema";

/**
 * Mega menü öne çıkan kartı için ANİMASYONLU MİNİ ÜRÜN ÖNİZLEMELERİ (medya yüklenmemişse). Satır içi SVG + CSS; dosya
 * indirmez, bağımlılık yok, istemci JS'i yok: sahnelere sunucuda çizilir ve istemci bileşenine hazır öğe olarak geçer
 * (`client-groups.tsx`), istemci yalnız hangi katmanın görünür olduğunu seçer.
 * Renkler `.mk-prev` üzerindeki `--mp-*` token'larından gelir (sabit hex yok). Temel görünüm = SON KARE; hareket yalnız
 * etkin katmanda (`.mk-prev-layer[data-on="true"]`) ve `prefers-reduced-motion: no-preference` içinde bir kez oynar
 * (marketing-sections.css, mk-mp-*); katman her etkinleştiğinde yeniden oynar. Fare konumu izlenmez.
 * İçerik ÖRNEKTİR (sayı/isim uydurma yok); dekoratif olduğu için aria-hidden. Kimlik (id) kullanılmaz: aynı sahne birden
 * çok panelde güvenle tekrar edebilir.
 */
const at = (i: number): CSSProperties => ({ "--i": i }) as CSSProperties;

function Scene({ kind }: { kind: FeaturedPreviewKind }) {
  switch (kind) {
    case "leak":
      // Kayıp-kaçak radarı: bir kez dönen tarama, beliren sinyaller (kırmızı = kaçan komisyon) ve sağda kırılım.
      return (
        <svg viewBox="0 0 160 90" focusable="false">
          <g transform="translate(46 46)">
            {[34, 23, 12].map((r) => (
              <circle key={r} r={r} fill="none" stroke="var(--mp-line)" />
            ))}
            <path d="M-34 0 H34 M0 -34 V34" stroke="var(--mp-line)" strokeDasharray="2 3" />
            <g className="mk-mp-spin">
              <circle r="34" fill="none" />
              <path d="M0 0 L0 -34 A34 34 0 0 1 29.4 -17 Z" fill="var(--mp-mint)" opacity="0.22" />
              <path d="M0 0 L29.4 -17" stroke="var(--mp-mint)" strokeWidth="1.5" />
            </g>
            <circle className="mk-mp-p" style={at(1)} cx="-14" cy="-18" r="3" fill="var(--mp-blue)" />
            <circle className="mk-mp-p" style={at(2)} cx="18" cy="10" r="3" fill="var(--mp-blue)" />
            <circle className="mk-mp-p" style={at(3)} cx="-20" cy="16" r="3" fill="var(--mp-blue)" />
            <circle className="mk-mp-p" style={at(4)} cx="10" cy="-22" r="7" fill="none" stroke="var(--mp-danger)" strokeWidth="1.5" />
            <circle className="mk-mp-p" style={at(4)} cx="10" cy="-22" r="3.5" fill="var(--mp-danger)" />
          </g>
          {[0, 1, 2].map((i) => (
            <g key={i} transform={`translate(92 ${20 + i * 20})`}>
              <rect width="56" height="5" rx="2.5" fill="var(--mp-soft)" />
              <rect className="mk-mp-x" style={at(i)} width={[44, 26, 14][i]} height="5" rx="2.5" fill={i === 0 ? "var(--mp-danger)" : "var(--mp-blue)"} />
              <rect y="9" width={[30, 22, 26][i]} height="3" rx="1.5" fill="var(--mp-line)" />
            </g>
          ))}
        </svg>
      );
    case "valuation":
      // Emsal değer eğrisi: emsaller belirir, değer aralığı bandı açılır, eğri çizilir, konu mülk altınla işaretlenir.
      return (
        <svg viewBox="0 0 160 90" focusable="false">
          <path d="M14 76 H148 M14 76 V12" stroke="var(--mp-line)" />
          <rect className="mk-mp-f" x="14" y="30" width="134" height="20" fill="var(--mp-blue)" opacity="0.14" />
          {[[24, 62], [38, 55], [50, 58], [64, 46], [78, 49], [92, 40], [106, 42], [120, 33], [136, 30]].map(([x, y], i) => (
            <circle key={i} className="mk-mp-p" style={at(i)} cx={x} cy={y} r="2.6" fill="var(--mp-sky)" />
          ))}
          <path className="mk-mp-d" pathLength={1} d="M18 64 C 48 58, 66 50, 86 44 S 124 34, 146 28" fill="none" stroke="var(--mp-blue)" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M86 44 V76" stroke="var(--mp-gold)" strokeDasharray="2 3" />
          <circle className="mk-mp-p" style={at(9)} cx="86" cy="44" r="5" fill="var(--mp-gold)" stroke="var(--mp-card)" strokeWidth="2" />
        </svg>
      );
    case "signature":
      // Dijital imza: belge, imza çizgisi çizilir, onay rozeti belirir, SMS hapı.
      return (
        <svg viewBox="0 0 160 90" focusable="false">
          <rect x="30" y="8" width="84" height="74" rx="8" fill="var(--mp-soft)" stroke="var(--mp-line)" />
          {[0, 1, 2, 3].map((i) => (
            <rect key={i} x="40" y={18 + i * 9} width={[60, 52, 64, 40][i]} height="4" rx="2" fill="var(--mp-line)" />
          ))}
          <path d="M40 70 H104" stroke="var(--mp-line)" strokeDasharray="3 3" />
          <path className="mk-mp-d" pathLength={1} d="M42 66 C 48 52, 54 54, 56 63 S 66 70, 72 58 S 84 54, 88 64 S 98 62, 104 58" fill="none" stroke="var(--mp-sky)" strokeWidth="2.2" strokeLinecap="round" />
          <g className="mk-mp-p" style={at(5)}>
            <circle cx="118" cy="22" r="11" fill="var(--mp-mint)" />
            <path d="M113 22 l3.5 3.5 l6.5 -7" fill="none" stroke="var(--mp-card)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </g>
          <rect className="mk-mp-r" style={at(1)} x="112" y="60" width="34" height="14" rx="7" fill="var(--mp-blue)" />
          <rect x="120" y="65.5" width="18" height="3" rx="1.5" fill="var(--mp-card)" opacity="0.8" />
        </svg>
      );
    case "plans":
      // Paketler: üç kart, ortadaki altın şeritli önerilen; kapsam çubukları yükselir.
      return (
        <svg viewBox="0 0 160 90" focusable="false">
          {[0, 1, 2].map((i) => {
            const mid = i === 1;
            const x = 14 + i * 46;
            return (
              <g key={i} className="mk-mp-r" style={at(i)}>
                <rect x={x} y={mid ? 6 : 12} width="40" height={mid ? 76 : 70} rx="8" fill={mid ? "var(--mp-soft-2)" : "var(--mp-soft)"} stroke={mid ? "var(--mp-gold)" : "var(--mp-line)"} />
                {mid ? <rect x={x + 10} y="3" width="20" height="6" rx="3" fill="var(--mp-gold)" /> : null}
                <rect x={x + 8} y={mid ? 16 : 22} width="18" height="4" rx="2" fill="var(--mp-ink)" opacity="0.7" />
                <rect x={x + 8} y={mid ? 24 : 30} width="12" height="3" rx="1.5" fill="var(--mp-line)" />
                <rect className="mk-mp-b" style={at(i + 1)} x={x + 8} y={66 - (i + 1) * 10} width="24" height={(i + 1) * 10 + 8} rx="4" fill={mid ? "var(--mp-blue)" : "var(--mp-sky)"} opacity={mid ? 1 : 0.6} />
              </g>
            );
          })}
        </svg>
      );
    case "assistant":
      // AI asistan: soru balonu, yazıyor noktaları, maskeli yanıt (telefon yerine ***), altın kıvılcım.
      return (
        <svg viewBox="0 0 160 90" focusable="false">
          <rect className="mk-mp-r" style={at(0)} x="56" y="8" width="90" height="20" rx="10" fill="var(--mp-blue)" />
          <rect x="66" y="16" width="62" height="4" rx="2" fill="var(--mp-card)" opacity="0.85" />
          <g className="mk-mp-r" style={at(1)}>
            <rect x="14" y="36" width="112" height="40" rx="10" fill="var(--mp-soft)" stroke="var(--mp-line)" />
            <rect x="24" y="45" width="80" height="4" rx="2" fill="var(--mp-ink)" opacity="0.75" />
            <rect x="24" y="54" width="58" height="4" rx="2" fill="var(--mp-ink)" opacity="0.45" />
            <rect x="24" y="63" width="34" height="5" rx="2.5" fill="var(--mp-mint)" opacity="0.5" />
            <text x="62" y="67.5" fontSize="6" fontWeight="700" fill="var(--mp-ink)" opacity="0.7">05•• ••• •• ••</text>
          </g>
          <path className="mk-mp-p" style={at(3)} d="M140 44 l2.2 5.8 l5.8 2.2 l-5.8 2.2 l-2.2 5.8 l-2.2 -5.8 l-5.8 -2.2 l5.8 -2.2 Z" fill="var(--mp-gold)" />
        </svg>
      );
    case "listing":
      // İlan kontrol: satırlar, bir kez yukarıdan aşağı geçen tarama çizgisi, satır sonunda durum işaretleri.
      return (
        <svg viewBox="0 0 160 90" focusable="false">
          {[0, 1, 2, 3].map((i) => (
            <g key={i} transform={`translate(14 ${10 + i * 19})`}>
              <rect width="132" height="15" rx="5" fill="var(--mp-soft)" />
              <rect x="4" y="3" width="14" height="9" rx="2.5" fill="var(--mp-line)" />
              <rect x="24" y="3.5" width={[54, 42, 60, 48][i]} height="3.5" rx="1.75" fill="var(--mp-ink)" opacity="0.65" />
              <rect x="24" y="9" width={[30, 36, 24, 32][i]} height="2.5" rx="1.25" fill="var(--mp-line)" />
              <circle className="mk-mp-p" style={at(i + 1)} cx="122" cy="7.5" r="4" fill={["var(--mp-mint)", "var(--mp-mint)", "var(--mp-danger)", "var(--mp-gold)"][i]} />
            </g>
          ))}
          <rect className="mk-mp-scan" x="10" y="8" width="140" height="2" rx="1" fill="var(--mp-sky)" />
        </svg>
      );
    case "security":
      // Güvenlik: kalkan çizilir, kilit belirir; sağda rol/izin satırları ve anahtarlar.
      return (
        <svg viewBox="0 0 160 90" focusable="false">
          <path className="mk-mp-d" pathLength={1} d="M46 10 L72 20 V44 C72 62, 60 74, 46 80 C32 74, 20 62, 20 44 V20 Z" fill="var(--mp-soft)" stroke="var(--mp-sky)" strokeWidth="2" strokeLinejoin="round" />
          <g className="mk-mp-p" style={at(3)}>
            <path d="M39 42 V36 a7 7 0 0 1 14 0 V42" fill="none" stroke="var(--mp-ink)" strokeWidth="2.4" />
            <rect x="35" y="42" width="22" height="16" rx="4" fill="var(--mp-gold)" />
          </g>
          {[0, 1, 2].map((i) => (
            <g key={i} className="mk-mp-r" style={at(i)} transform={`translate(86 ${18 + i * 20})`}>
              <rect width="60" height="14" rx="7" fill="var(--mp-soft)" />
              <rect x="8" y="5" width={[26, 20, 30][i]} height="4" rx="2" fill="var(--mp-ink)" opacity="0.6" />
              <rect x="42" y="3" width="14" height="8" rx="4" fill={i === 2 ? "var(--mp-line)" : "var(--mp-mint)"} />
              <circle cx={i === 2 ? 46 : 52} cy="7" r="3" fill="var(--mp-card)" />
            </g>
          ))}
        </svg>
      );
    case "automation":
      // Otomasyon: tetikleyici → koşul → iki eylem; bağlantılar çizilir, düğümler sırayla belirir.
      return (
        <svg viewBox="0 0 160 90" focusable="false">
          <path className="mk-mp-d" pathLength={1} d="M42 45 H62 M98 45 C108 45, 108 24, 118 24 M98 45 C108 45, 108 66, 118 66" fill="none" stroke="var(--mp-sky)" strokeWidth="2" strokeLinecap="round" />
          <g className="mk-mp-p" style={at(0)}>
            <rect x="12" y="33" width="30" height="24" rx="7" fill="var(--mp-blue)" />
            <path d="M24 39 l-4 7 h5 l-2 6 l7 -9 h-5 l2 -4 Z" fill="var(--mp-card)" />
          </g>
          <g className="mk-mp-p" style={at(2)}>
            <rect x="62" y="31" width="36" height="28" rx="8" fill="var(--mp-soft-2)" stroke="var(--mp-gold)" />
            <rect x="70" y="40" width="20" height="4" rx="2" fill="var(--mp-ink)" opacity="0.7" />
            <rect x="70" y="47" width="12" height="3" rx="1.5" fill="var(--mp-line)" />
          </g>
          {[24, 66].map((y, i) => (
            <g key={y} className="mk-mp-p" style={at(4 + i)}>
              <rect x="118" y={y - 10} width="30" height="20" rx="7" fill="var(--mp-soft)" stroke="var(--mp-line)" />
              <circle cx="127" cy={y} r="3" fill={i === 0 ? "var(--mp-mint)" : "var(--mp-sky)"} />
              <rect x="133" y={y - 1.5} width="10" height="3" rx="1.5" fill="var(--mp-ink)" opacity="0.6" />
            </g>
          ))}
        </svg>
      );
    case "dashboard":
      // Ofis paneli: lacivert yan menü, üç KPI kartı, altın komisyon eğrisi çizilir.
      return (
        <svg viewBox="0 0 160 90" focusable="false">
          <rect x="6" y="6" width="26" height="78" rx="6" fill="var(--mp-deep)" />
          <rect x="11" y="16" width="16" height="5" rx="2.5" fill="var(--mp-blue)" />
          {[28, 37, 46].map((y) => (
            <rect key={y} x="11" y={y} width="14" height="3" rx="1.5" fill="var(--mp-line)" />
          ))}
          {[0, 1, 2].map((i) => (
            <g key={i} className="mk-mp-r" style={at(i)}>
              <rect x={38 + i * 39} y="8" width="34" height="22" rx="5" fill="var(--mp-soft)" />
              <rect x={43 + i * 39} y="13" width="12" height="3" rx="1.5" fill="var(--mp-line)" />
              <rect x={43 + i * 39} y="20" width={[18, 14, 20][i]} height="5" rx="2" fill="var(--mp-ink)" opacity="0.8" />
            </g>
          ))}
          <rect x="38" y="36" width="112" height="48" rx="6" fill="var(--mp-soft)" />
          <path className="mk-mp-f" d="M44 74 C 58 72, 64 66, 76 66 S 96 54, 108 52 S 130 44, 144 42 V78 H44 Z" fill="var(--mp-gold)" opacity="0.2" />
          <path className="mk-mp-d" pathLength={1} d="M44 74 C 58 72, 64 66, 76 66 S 96 54, 108 52 S 130 44, 144 42" fill="none" stroke="var(--mp-gold)" strokeWidth="2.2" strokeLinecap="round" />
          <circle className="mk-mp-p" style={at(6)} cx="144" cy="42" r="3.2" fill="var(--mp-gold)" stroke="var(--mp-card)" strokeWidth="1.5" />
        </svg>
      );
  }
}

/** Tek önizleme sahnesi: `label` kart altında küçük alt yazıdır (hangi öğenin önizlendiği). */
export function FeaturedPreview({ kind, label }: { kind: FeaturedPreviewKind; label?: string }) {
  return (
    <span className="mk-prev" data-kind={kind} aria-hidden="true">
      <Scene kind={kind} />
      <em className="mk-prev-tag">Örnek veri</em>
      {label ? <span className="mk-prev-cap">{label}</span> : null}
    </span>
  );
}
