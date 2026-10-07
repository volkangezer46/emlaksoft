"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function DanismanKpiError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Danışman performansı" />;
}
