import type { ReactNode } from "react";

/** Paylaşılan tarayıcı penceresi çerçevesi. Sunucu bileşeni; içerik SVG. Dar ekranda yatay kaydırılabilir (klavye ile odaklanır). */
export function DeviceFrame({ label, example = true, children }: { label: string; example?: boolean; children: ReactNode }) {
  return (
    <div className="mk-device">
      <div className="mk-device-bar" aria-hidden="true">
        <span className="mk-dots"><i /><i /><i /></span>
        <span className="mk-url">{label}</span>
        <span style={{ width: "2.2rem" }} />
      </div>
      <div className="mk-device-screen-wrap" tabIndex={0} role="region" aria-label={`${label} örnek ekranı, yatay kaydırılabilir`}>{children}</div>
      {example ? <span className="mk-tag mk-example">Örnek ekran · örnek veri</span> : null}
    </div>
  );
}
