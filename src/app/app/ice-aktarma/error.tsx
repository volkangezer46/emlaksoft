"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function IceAktarmaError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="İçe aktarma" />;
}
