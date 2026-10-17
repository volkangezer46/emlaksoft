"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function AdminZekaError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Zeka eğitimi" homeHref="/admin" homeLabel="Yönetim paneline dön" />;
}
