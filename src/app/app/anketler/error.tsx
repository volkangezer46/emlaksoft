"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function AnketlerError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Anketler" />;
}
