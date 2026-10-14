"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function AdminMarkaError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Marka" homeHref="/admin" homeLabel="Yönetim paneline dön" />;
}
