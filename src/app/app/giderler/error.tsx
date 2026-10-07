"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function GiderlerError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Giderler" />;
}
