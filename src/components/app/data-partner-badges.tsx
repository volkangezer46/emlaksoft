import type { LucideIcon } from "lucide-react";
import { CheckCircle2, Circle } from "lucide-react";

/** Değerleme sayfası hero'sunda Endeksa/Tapusor bağlantı durumu rozeti */
export function DataPartnerStatus({
  name,
  icon: Icon,
  configured,
}: {
  name: string;
  icon: LucideIcon;
  configured: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-2.5 rounded-[12px] border px-3 py-2 backdrop-blur ${
        configured ? "border-mint-400/30 bg-mint-400/10" : "border-white/10 bg-white/5"
      }`}
    >
      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-[9px] ${configured ? "bg-mint-400/20 text-mint-300" : "bg-white/10 text-white/50"}`}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-bold text-white">{name}</p>
        <p className={`flex items-center gap-1 text-[11px] font-semibold ${configured ? "text-mint-300" : "text-white/40"}`}>
          {configured ? <CheckCircle2 className="h-3 w-3" /> : <Circle className="h-3 w-3" />}
          {configured ? "Bağlı · canlı" : "Bağlantı bekliyor"}
        </p>
      </div>
    </div>
  );
}

/** Ana sayfa / genel yerlerde kullanılan açık temalı veri ortağı kartı */
export function DataPartnerCard({
  name,
  icon: Icon,
  description,
  tag,
}: {
  name: string;
  icon: LucideIcon;
  description: string;
  tag: string;
}) {
  return (
    <div className="lift rounded-[16px] border border-line bg-surface p-5 transition hover:border-brand-300">
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[12px] bg-brand-600/10 text-brand-600">
          <Icon className="h-5 w-5" />
        </span>
        <div>
          <p className="font-display font-bold text-ink-950">{name}</p>
          <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-mint-600">{tag}</span>
        </div>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-text-muted">{description}</p>
    </div>
  );
}
