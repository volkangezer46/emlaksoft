/**
 * Admin sayfa geçiş animasyonu — her navigasyonda zarif giriş (page-in).
 */
export default function AdminTemplate({ children }: { children: React.ReactNode }) {
  return <div className="page-in">{children}</div>;
}
