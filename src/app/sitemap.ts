import type { MetadataRoute } from "next";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export default function sitemap(): MetadataRoute.Sitemap {
  const routes = [
    { path: "", priority: 1, freq: "weekly" as const },
    { path: "/kayit", priority: 0.9, freq: "monthly" as const },
    { path: "/giris", priority: 0.5, freq: "monthly" as const },
    { path: "/demo", priority: 0.8, freq: "monthly" as const },
    { path: "/gizlilik", priority: 0.3, freq: "yearly" as const },
    { path: "/kullanim-sartlari", priority: 0.3, freq: "yearly" as const },
  ];

  return routes.map((route) => ({
    url: `${BASE_URL}${route.path}`,
    lastModified: new Date(),
    changeFrequency: route.freq,
    priority: route.priority,
  }));
}
