import {
  Bell,
  Building2,
  LayoutDashboard,
  Phone,
  Radar,
  Users,
  Wallet,
} from "lucide-react";

export function DashboardMock() {
  return (
    <div className="overflow-hidden rounded-[18px] border border-line bg-surface premium-shadow">
      {/* browser chrome */}
      <div className="window-chrome flex items-center gap-3 px-4 py-3">
        <div className="flex gap-1.5">
          <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
          <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
          <span className="h-3 w-3 rounded-full bg-[#28c840]" />
        </div>
        <div className="mx-auto flex items-center gap-2 rounded-full bg-white/10 px-4 py-1 text-[11px] text-white/70">
          <span className="h-2 w-2 rounded-full bg-mint-400" />
          app.emlaksoft.com.tr/panel
        </div>
      </div>

      <div className="grid grid-cols-[56px_1fr] bg-canvas">
        {/* mini sidebar */}
        <div className="flex flex-col items-center gap-1 border-r border-line bg-surface py-4">
          <span className="mb-3 grid h-8 w-8 place-items-center rounded-[9px] bg-[image:var(--grad-brand)] text-xs font-bold text-white">
            E
          </span>
          {[LayoutDashboard, Users, Building2, Phone, Wallet].map((Icon, i) => (
            <span
              key={i}
              className={`grid h-9 w-9 place-items-center rounded-[10px] ${
                i === 0 ? "bg-brand-600/10 text-brand-600" : "text-text-faint"
              }`}
            >
              <Icon className="h-4 w-4" />
            </span>
          ))}
        </div>

        {/* content */}
        <div className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-display text-sm font-bold text-ink-950">Günaydın, Volkan</p>
              <p className="text-[11px] text-text-muted">Bugünün operasyon özeti</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-mint-500/12 px-2 py-1 text-[11px] font-semibold text-mint-600">
                Ofis skoru 78
              </span>
              <span className="grid h-7 w-7 place-items-center rounded-full bg-ink-800 text-[10px] font-bold text-white">
                VG
              </span>
            </div>
          </div>

          {/* KPIs */}
          <div className="mt-4 grid grid-cols-4 gap-2">
            {[
              { l: "Arayan", v: "14", c: "text-ink-950" },
              { l: "Yeni portföy", v: "3", c: "text-ink-950" },
              { l: "Teyitsiz", v: "23", c: "text-warn-500" },
              { l: "Kayıp/ay", v: "420B", c: "text-danger-500" },
            ].map((k) => (
              <div key={k.l} className="rounded-[10px] border border-line bg-surface p-2.5">
                <p className="text-[10px] text-text-muted">{k.l}</p>
                <p className={`font-display text-lg font-extrabold ${k.c}`}>{k.v}</p>
              </div>
            ))}
          </div>

          <div className="mt-3 grid grid-cols-[1.5fr_1fr] gap-3">
            {/* chart */}
            <div className="rounded-[12px] border border-line bg-surface p-3">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold text-ink-950">Aylık hakediş</p>
                <span className="flex items-center gap-1 rounded-full bg-mint-500/12 px-1.5 py-0.5 text-[10px] font-semibold text-mint-600">
                  +18%
                </span>
              </div>
              <svg viewBox="0 0 260 90" className="mt-2 h-24 w-full" role="img" aria-label="grafik">
                <defs>
                  <linearGradient id="mockArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--cyan-400)" stopOpacity="0.35" />
                    <stop offset="100%" stopColor="var(--brand-600)" stopOpacity="0" />
                  </linearGradient>
                  <linearGradient id="mockStroke" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="var(--brand-600)" />
                    <stop offset="0.5" stopColor="var(--cyan-400)" />
                    <stop offset="100%" stopColor="var(--mint-500)" />
                  </linearGradient>
                </defs>
                {[24, 48, 72].map((y) => (
                  <line key={y} x1="0" y1={y} x2="260" y2={y} stroke="rgba(10,34,71,0.06)" strokeWidth="1" strokeDasharray="2 5" />
                ))}
                <path d="M0,72 C25,68 40,60 60,62 C82,64 95,44 120,42 C145,40 158,50 180,36 C205,20 220,18 260,8 L260,90 L0,90 Z" fill="url(#mockArea)" />
                <path className="chart-draw" style={{ "--len": "340" } as React.CSSProperties} d="M0,72 C25,68 40,60 60,62 C82,64 95,44 120,42 C145,40 158,50 180,36 C205,20 220,18 260,8" fill="none" stroke="url(#mockStroke)" strokeWidth="2.5" strokeLinecap="round" />
                <path className="flow-line" d="M0,72 C25,68 40,60 60,62 C82,64 95,44 120,42 C145,40 158,50 180,36 C205,20 220,18 260,8" fill="none" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" opacity="0.7" />
                <circle className="glow-halo" cx="260" cy="8" r="4" fill="var(--mint-500)" />
                <circle className="glow-dot" cx="260" cy="8" r="3.5" fill="#fff" stroke="var(--mint-500)" strokeWidth="2" />
              </svg>
              <div className="grid grid-cols-3 gap-1 text-center">
                {["Oca", "Şub", "Mar"].map((m) => (
                  <span key={m} className="text-[9px] text-text-faint">{m}</span>
                ))}
              </div>
            </div>

            {/* alerts */}
            <div className="rounded-[12px] border border-line bg-surface p-3">
              <div className="flex items-center gap-1.5">
                <Radar className="h-3.5 w-3.5 text-danger-500" />
                <p className="text-[11px] font-semibold text-ink-950">Kayıp-kaçak</p>
              </div>
              <div className="mt-2 space-y-1.5">
                <div className="rounded-[8px] bg-danger-500/8 px-2 py-1.5">
                  <p className="text-[10px] font-semibold text-ink-950">#99211 düştü</p>
                  <p className="text-[9px] text-text-muted">Sebep yok</p>
                </div>
                <div className="rounded-[8px] bg-warn-500/10 px-2 py-1.5">
                  <p className="text-[10px] font-semibold text-ink-950">7 gün teyitsiz</p>
                  <p className="text-[9px] text-text-muted">12 ilan</p>
                </div>
                <div className="flex items-center gap-1.5 rounded-[8px] bg-mint-500/10 px-2 py-1.5">
                  <Bell className="h-3 w-3 text-mint-600" />
                  <p className="text-[10px] font-semibold text-mint-600">2 hatırlatma</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
