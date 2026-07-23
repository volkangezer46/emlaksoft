import { Activity, ArrowUpRight, BarChart3, Gauge, TrendingUp, Wallet } from "lucide-react";
import { CountUp } from "@/components/count-up";
import { Reveal } from "@/components/reveal";

const bars = [
  { m: "Oca", v: 46 },
  { m: "Şub", v: 58 },
  { m: "Mar", v: 51 },
  { m: "Nis", v: 69 },
  { m: "May", v: 62 },
  { m: "Haz", v: 82 },
  { m: "Tem", v: 94 },
];

const donut = [
  { label: "Ofis payı", value: 52, color: "var(--brand-600)" },
  { label: "Danışman", value: 33, color: "var(--mint-500)" },
  { label: "Merkez", value: 15, color: "var(--cyan-400)" },
];

// area chart geometry
const AREA_LINE =
  "M0 176 C60 168 92 150 132 156 S214 118 268 130 S346 92 398 100 S482 62 534 72 S612 30 700 22";
const AREA_FILL = `${AREA_LINE} L700 200 L0 200 Z`;
const dots = [
  { x: 132, y: 156 },
  { x: 268, y: 130 },
  { x: 398, y: 100 },
  { x: 534, y: 72 },
  { x: 700, y: 22 },
];

function gaugeGeometry(percent: number) {
  const r = 70;
  const circ = 2 * Math.PI * r;
  const dash = circ * (1 - percent / 100);
  return { r, circ, dash };
}

export function LiveAnalytics() {
  const gauge = gaugeGeometry(78);

  return (
    <section className="theme-dark relative overflow-hidden bg-[image:var(--grad-ink)] py-14 text-white md:py-20">
      <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
      <div className="pointer-events-none absolute left-[-6%] top-[-10%] h-96 w-96 rounded-full bg-brand-600/25 blur-[120px]" />
      <div className="pointer-events-none absolute bottom-[-15%] right-[-4%] h-96 w-96 rounded-full bg-mint-500/20 blur-[120px]" />

      <div className="relative mx-auto max-w-6xl px-4">
        <Reveal className="mx-auto max-w-2xl text-center">
          <span className="eyebrow border border-white/10 bg-white/8 text-cyan-400">
            <Activity className="h-3.5 w-3.5" /> Canlı analitik
          </span>
          <h2 className="mt-4 font-display text-3xl font-extrabold text-white md:text-4xl">
            Verileriniz <span className="text-gradient">canlı</span> akar, karar hızlanır
          </h2>
          <p className="mt-3 text-white/65">
            Hakediş, dönüşüm ve ofis skoru gerçek zamanlı grafiklerle önünüzde. Statik rapor değil, nabız gibi atan bir merkez.
          </p>
        </Reveal>

        <div className="mt-10 grid gap-5 lg:grid-cols-[1.55fr_1fr]">
          {/* MAIN ANIMATED AREA CHART */}
          <Reveal variant="scale" className="relative overflow-hidden rounded-[24px] border border-white/10 bg-white/[0.04] p-6 backdrop-blur">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="flex items-center gap-2 text-xs font-semibold text-cyan-400"><BarChart3 className="h-4 w-4" /> Aylık hakediş akışı</p>
                <div className="mt-1 flex items-end gap-2">
                  <span className="font-display text-3xl font-extrabold text-white">₺<CountUp to={2.4} decimals={1} />M</span>
                  <span className="mb-1 flex items-center gap-1 rounded-full bg-mint-400/15 px-2 py-0.5 text-[11px] font-bold text-mint-400"><TrendingUp className="h-3 w-3" /> +18%</span>
                </div>
              </div>
              <div className="flex gap-4 text-right">
                <div><p className="text-[10px] uppercase tracking-wide text-white/40">Tahsil</p><p className="font-display text-lg font-bold text-white">₺2,1M</p></div>
                <div><p className="text-[10px] uppercase tracking-wide text-white/40">Bekleyen</p><p className="font-display text-lg font-bold text-amber-400">₺186B</p></div>
              </div>
            </div>

            <div className="relative mt-6">
              {/* scanning gridline */}
              <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[14px]">
                <div className="grid-scan absolute inset-y-0 w-24 bg-gradient-to-r from-transparent via-cyan-400/10 to-transparent" />
              </div>

              <svg viewBox="0 0 700 200" className="relative h-56 w-full md:h-64" preserveAspectRatio="none" role="img" aria-label="Aylık hakediş grafiği">
                <defs>
                  <linearGradient id="laArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--cyan-400)" stopOpacity="0.42" />
                    <stop offset="55%" stopColor="var(--brand-500)" stopOpacity="0.14" />
                    <stop offset="100%" stopColor="var(--brand-600)" stopOpacity="0" />
                  </linearGradient>
                  <linearGradient id="laStroke" x1="0" y1="0" x2="1" y2="0">
                    <stop stopColor="var(--brand-400)" />
                    <stop offset="0.5" stopColor="var(--cyan-400)" />
                    <stop offset="1" stopColor="var(--mint-400)" />
                  </linearGradient>
                  <linearGradient id="laSheen" x1="0" y1="0" x2="1" y2="0">
                    <stop stopColor="#fff" stopOpacity="0" />
                    <stop offset="0.5" stopColor="#fff" stopOpacity="0.5" />
                    <stop offset="1" stopColor="#fff" stopOpacity="0" />
                  </linearGradient>
                </defs>

                {/* dashed gridlines */}
                {[40, 80, 120, 160].map((y) => (
                  <line key={y} x1="0" y1={y} x2="700" y2={y} stroke="rgba(255,255,255,0.06)" strokeWidth="1" strokeDasharray="3 6" />
                ))}

                <path d={AREA_FILL} fill="url(#laArea)" />
                {/* base drawn line */}
                <path className="chart-draw" style={{ "--len": "1100" } as React.CSSProperties} d={AREA_LINE} fill="none" stroke="url(#laStroke)" strokeWidth="3.5" strokeLinecap="round" />
                {/* flowing energy overlay */}
                <path className="flow-line" d={AREA_LINE} fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" opacity="0.55" />

                {/* data dots */}
                {dots.map((d, i) => (
                  <g key={d.x}>
                    {i === dots.length - 1 ? (
                      <circle className="glow-halo" cx={d.x} cy={d.y} r="6" fill="var(--mint-400)" />
                    ) : null}
                    <circle className={i === dots.length - 1 ? "glow-dot" : ""} cx={d.x} cy={d.y} r="4" fill="#fff" stroke="var(--cyan-400)" strokeWidth="2.5" />
                  </g>
                ))}
              </svg>

              {/* moving sheen */}
              <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[14px]">
                <div className="area-sheen absolute inset-y-0 -left-1/4 w-1/3 skew-x-12 bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.08),transparent)]" />
              </div>

              {/* rising particles */}
              <div className="pointer-events-none absolute inset-0">
                {[18, 42, 66, 88].map((left, i) => (
                  <span key={left} className="particle absolute bottom-6 h-1 w-1 rounded-full bg-cyan-400/70" style={{ left: `${left}%`, animationDelay: `${i * 1.1}s` }} />
                ))}
              </div>
            </div>

            <div className="mt-3 grid grid-cols-7 text-center text-[10px] text-white/40">
              {bars.map((b) => <span key={b.m}>{b.m}</span>)}
            </div>

            <div className="mt-4 flex flex-wrap gap-4 border-t border-white/8 pt-4 text-[11px]">
              <span className="flex items-center gap-1.5 text-white/60"><span className="legend-blink h-2 w-2 rounded-full bg-cyan-400" /> Tahsil edilen</span>
              <span className="flex items-center gap-1.5 text-white/60"><span className="legend-blink h-2 w-2 rounded-full bg-mint-400" style={{ animationDelay: "0.6s" }} /> Hedef çizgisi</span>
              <span className="flex items-center gap-1.5 text-white/60"><span className="legend-blink h-2 w-2 rounded-full bg-amber-400" style={{ animationDelay: "1.1s" }} /> Bekleyen</span>
            </div>
          </Reveal>

          {/* RIGHT: gauge + bars */}
          <div className="grid gap-5">
            {/* radial gauge */}
            <Reveal variant="scale" className="relative overflow-hidden rounded-[24px] border border-white/10 bg-white/[0.04] p-6 backdrop-blur">
              <div className="flex items-center justify-between">
                <p className="flex items-center gap-2 text-xs font-semibold text-mint-400"><Gauge className="h-4 w-4" /> Ofis sağlık skoru</p>
                <span className="status-pulse h-2 w-2 rounded-full bg-mint-400" />
              </div>
              <div className="relative mx-auto mt-3 grid h-44 w-44 place-items-center">
                <div className="conic-spin pointer-events-none absolute inset-0 rounded-full opacity-40" style={{ background: "conic-gradient(from 0deg, transparent 0 60%, rgba(52,211,189,0.6) 78%, rgba(34,211,238,0.6) 90%, transparent 100%)", filter: "blur(14px)" }} />
                <svg viewBox="0 0 180 180" className="relative h-44 w-44 -rotate-90">
                  <defs>
                    <linearGradient id="gaugeStroke" x1="0" y1="0" x2="1" y2="1">
                      <stop stopColor="var(--mint-400)" />
                      <stop offset="1" stopColor="var(--cyan-400)" />
                    </linearGradient>
                  </defs>
                  <circle cx="90" cy="90" r={gauge.r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="12" />
                  <circle
                    className="ring-sweep"
                    style={{ "--circ": String(gauge.circ), "--dash": String(gauge.dash) } as React.CSSProperties}
                    cx="90"
                    cy="90"
                    r={gauge.r}
                    fill="none"
                    stroke="url(#gaugeStroke)"
                    strokeWidth="12"
                    strokeLinecap="round"
                  />
                </svg>
                <div className="absolute grid place-items-center text-center">
                  <span className="font-display text-4xl font-extrabold text-white"><CountUp to={78} /></span>
                  <span className="text-[10px] uppercase tracking-wide text-white/45">/ 100 puan</span>
                </div>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                {[{ l: "Teyit", v: "%92" }, { l: "Dönüşüm", v: "%8,3" }, { l: "Kaçak", v: "-8%" }].map((x) => (
                  <div key={x.l} className="rounded-[11px] border border-white/8 bg-white/5 py-2"><p className="font-display text-sm font-bold text-white">{x.v}</p><p className="text-[9px] text-white/40">{x.l}</p></div>
                ))}
              </div>
            </Reveal>

            {/* animated bars + donut */}
            <Reveal variant="scale" className="relative overflow-hidden rounded-[24px] border border-white/10 bg-white/[0.04] p-6 backdrop-blur">
              <p className="flex items-center gap-2 text-xs font-semibold text-brand-300"><Wallet className="h-4 w-4" /> Haftalık kapanış ritmi</p>
              <div className="mt-4 flex h-24 items-end justify-between gap-2">
                {bars.map((b, i) => (
                  <div key={b.m} className="flex flex-1 flex-col items-center gap-1.5">
                    <div className="flex h-20 w-full items-end justify-center">
                      <span
                        className="bar-live w-full max-w-[16px] rounded-t-[5px] bg-[linear-gradient(180deg,var(--cyan-400),var(--brand-600))]"
                        style={{ height: `${b.v}%`, animationDelay: `${i * 90}ms, ${i * 200}ms` }}
                      />
                    </div>
                    <span className="text-[9px] text-white/40">{b.m}</span>
                  </div>
                ))}
              </div>

              <div className="mt-5 flex items-center gap-4 border-t border-white/8 pt-4">
                {/* mini donut */}
                <div className="relative h-20 w-20 shrink-0">
                  <div
                    className="h-20 w-20 rounded-full"
                    style={{
                      background: `conic-gradient(var(--brand-600) 0 52%, var(--mint-500) 52% 85%, var(--cyan-400) 85% 100%)`,
                      mask: "radial-gradient(circle at center, transparent 54%, #000 55%)",
                      WebkitMask: "radial-gradient(circle at center, transparent 54%, #000 55%)",
                    }}
                  />
                  <div className="absolute inset-0 grid place-items-center"><span className="font-display text-xs font-bold text-white">%100</span></div>
                </div>
                <div className="flex-1 space-y-1.5">
                  {donut.map((d) => (
                    <div key={d.label} className="flex items-center justify-between text-[11px]">
                      <span className="flex items-center gap-1.5 text-white/60"><span className="h-2 w-2 rounded-full" style={{ background: d.color }} /> {d.label}</span>
                      <span className="font-semibold text-white">%{d.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </Reveal>
          </div>
        </div>

        <Reveal className="mt-6 flex justify-center">
          <a href="/kayit" className="btn-shine inline-flex items-center gap-2 rounded-[12px] bg-white px-6 py-3 text-sm font-bold text-ink-950">
            Canlı paneli deneyin <ArrowUpRight className="h-4 w-4" />
          </a>
        </Reveal>
      </div>
    </section>
  );
}
