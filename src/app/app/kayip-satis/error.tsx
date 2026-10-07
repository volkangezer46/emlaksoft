"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function KayipSatisError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Risk altındaki müşteriler" />;
}
