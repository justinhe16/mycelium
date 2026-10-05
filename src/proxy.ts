import type { NextRequest } from "next/server";
import { checkSameOrigin, isLoopbackHost } from "@/lib/same-origin";

/**
 * Two guards for a server that trusts whoever can reach it:
 *  - every request must be addressed to a loopback host (blocks DNS rebinding,
 *    which would otherwise let a website read pages and API responses);
 *  - mutating API requests must come from this origin (CSRF / drive-by localhost).
 */
export function proxy(request: NextRequest) {
  if (!isLoopbackHost(request.headers.get("host"))) {
    return new Response("Forbidden: Mycelium only answers on 127.0.0.1 / localhost.", { status: 403 });
  }
  if (request.nextUrl.pathname.startsWith("/api/")) {
    const result = checkSameOrigin({ method: request.method, url: request.url, headers: request.headers });
    if (!result.ok) return Response.json({ error: result.error }, { status: 403 });
  }
}

export const config = {
  // Everything except static build assets.
  matcher: "/((?!_next/static|_next/image).*)",
};
