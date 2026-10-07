"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function AdminDuyuruError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Duyurular" homeHref="/admin" homeLabel="Yönetim paneline dön" />;
}
