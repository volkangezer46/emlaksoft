import {
  BarChart3,
  Building2,
  Code2,
  CreditCard,
  Database,
  Landmark,
  MessageCircle,
  Scale,
} from "lucide-react";

type Node = {
  icon: React.ComponentType<{ className?: string }>;
  name: string;
  tone: string;
};

const nodes: Node[] = [
  { icon: Landmark, name: "TCMB", tone: "text-brand-300" },
  { icon: BarChart3, name: "TÜİK", tone: "text-cyan-400" },
  { icon: CreditCard, name: "iyzico", tone: "text-mint-400" },
  { icon: MessageCircle, name: "WhatsApp", tone: "text-mint-400" },
  { icon: Scale, name: "İYS/EİDS", tone: "text-amber-300" },
  { icon: Building2, name: "Portallar", tone: "text-brand-300" },
  { icon: Code2, name: "API", tone: "text-cyan-400" },
  { icon: Database, name: "Excel", tone: "text-amber-300" },
];

const R = 40;
const CENTER = 50;

function pos(index: number, total: number) {
  const angle = (-90 + (index * 360) / total) * (Math.PI / 180);
  return {
    x: CENTER + R * Math.cos(angle),
    y: CENTER + R * Math.sin(angle),
  };
}

export function IntegrationHub() {
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[440px]">
      {/* connection lines */}
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" aria-hidden="true">
        <defs>
          <radialGradient id="hubGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--brand-500)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--brand-500)" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="50" cy="50" r="30" fill="url(#hubGlow)" />
        <circle cx="50" cy="50" r={R} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="0.4" strokeDasharray="1 2" />
        {nodes.map((node, i) => {
          const p = pos(i, nodes.length);
          return (
            <g key={node.name}>
              <line x1="50" y1="50" x2={p.x} y2={p.y} stroke="rgba(255,255,255,0.12)" strokeWidth="0.5" />
              <line className="trace-flow" x1="50" y1="50" x2={p.x} y2={p.y} stroke="var(--cyan-400)" strokeWidth="0.6" opacity="0.7" />
            </g>
          );
        })}
      </svg>

      {/* center node */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <div className="pulse-ring grid h-20 w-20 place-items-center rounded-[22px] bg-[image:var(--grad-brand)] shadow-[var(--shadow-glow-brand)]">
          <span className="font-display text-3xl font-extrabold text-white">E</span>
        </div>
      </div>

      {/* outer nodes */}
      {nodes.map((node, i) => {
        const p = pos(i, nodes.length);
        return (
          <div
            key={node.name}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${p.x}%`, top: `${p.y}%` }}
          >
            <div className="lift flex flex-col items-center gap-1.5">
              <span className="grid h-12 w-12 place-items-center rounded-[14px] border border-white/12 bg-white/8 backdrop-blur">
                <node.icon className={`h-5 w-5 ${node.tone}`} />
              </span>
              <span className="rounded-full bg-ink-950/60 px-2 py-0.5 text-[10px] font-semibold text-white/70 backdrop-blur">{node.name}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
