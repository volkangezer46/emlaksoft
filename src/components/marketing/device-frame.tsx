import type { ReactNode } from "react";

/** Paylaşılan tarayıcı penceresi çerçevesi. Sunucu bileşeni; içerik SVG/HTML. */
export function DeviceFrame({
  label,
  crop = false,
  example = true,
  children,
}: {
  label: string;
  crop?: boolean;
  example?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`mk-device${crop ? " mk-crop" : ""}`}>
      <div className="mk-device-bar" aria-hidden="true">
        <span className="mk-dots"><i /><i /><i /></span>
        <span className="mk-url">{label}</span>
        <span style={{ width: "2.2rem" }} />
      </div>
      {example ? <span className="mk-tag mk-example">Örnek ekran · örnek veri</span> : null}
      <div className="mk-device-screen-wrap">{children}</div>
    </div>
  );
}
