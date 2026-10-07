"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function PortfoylerError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Portföyler" />;
}
