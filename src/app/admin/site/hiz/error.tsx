"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function AdminSpeedError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Hız" homeHref="/admin" homeLabel="Yönetim paneline dön" />;
}
