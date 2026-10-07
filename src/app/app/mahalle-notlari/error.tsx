"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function MahalleNotlariError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Mahalle notları" />;
}
