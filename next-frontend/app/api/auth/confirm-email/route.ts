import { NextResponse } from "next/server";

import type { ConfirmEmailDto, ApiErrorEnvelope } from "@/lib/api/contracts";
import { upstream } from "@/lib/api/upstream";

// The upstream contract only exposes GET /auth/confirm-email with the token
// as a query param (the current openapi.json does not even declare that
// query param — spec gap the API team is expected to close). This BFF route
// is intentionally POST-only: confirmation is a state-changing action, and a
// GET route reachable from `/api/auth/confirm-email?token=...` risks being
// silently prefetched by email-client link scanners, confirming (or
// invalidating) tokens the user never clicked. The confirm-email page
// triggers this POST from an explicit user action / client-side effect it
// controls, never a bare hyperlink.
export async function POST(request: Request) {
  const body = (await request.json()) as ConfirmEmailDto;

  const { error, response } = await upstream.GET("/auth/confirm-email", {
    params: { query: { token: body.token } as never },
  });

  if (error) {
    return NextResponse.json<ApiErrorEnvelope>(error as ApiErrorEnvelope, {
      status: response.status,
    });
  }

  return new Response(null, { status: 204 });
}
