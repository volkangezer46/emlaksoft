"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function AdminGrowthError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Büyüme programı" homeHref="/admin" homeLabel="Yönetim paneline dön" />;
}
