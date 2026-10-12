"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function PortfoyAviError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Sahibinden ilanlar" />;
}
