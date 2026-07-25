/**
 * Panel sayfa geçiş animasyonu — her navigasyonda yeniden mount olur,
 * içerik zarif bir yükselme + fade ile girer (0.3s, reduced-motion'da kapalı).
 */
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  return <div className="page-in">{children}</div>;
}
