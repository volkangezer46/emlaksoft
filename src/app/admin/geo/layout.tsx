import { GeoTabs } from "./geo-tabs";

export default function AdminGeoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <GeoTabs />
      {children}
    </div>
  );
}
