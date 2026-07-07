import { NextResponse } from "next/server";

import type { LoginDto, LoginTokenPair, ApiErrorEnvelope, CurrentUser } from "@/lib/api/contracts";
import { upstream } from "@/lib/api/upstream";
import { setSession } from "@/lib/auth/session";

export async function POST(request: Request) {
  const body = (await request.json()) as LoginDto;

  const { data, error, response } = await upstream.POST("/auth/login", {
    body: body as never,
  });
  if (error) {
    return NextResponse.json<ApiErrorEnvelope>(error as ApiErrorEnvelope, {
      status: response.status,
    });
  }

  const tokens = data as LoginTokenPair;
  const accessToken = tokens.access_token ?? "";

  // Hydrate the session with the real profile via /auth/me — the upstream
  // login response carries only tokens, no profile data.
  const { data: me } = await upstream.GET("/auth/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const profile = me as CurrentUser | undefined;

  // Seal tokens into the iron-session cookie — tokens never cross to the browser.
  await setSession({
    accessToken,
    refreshToken: tokens.refresh_token ?? "",
    userId: profile?.sub ?? "",
    email: profile?.email ?? (body as Record<string, string>).email ?? "",
    // /auth/me does not expose channelSlug yet (upstream contract gap) —
    // left empty until the API grows a channel-bearing profile endpoint.
    channelSlug: "",
  });

  // FE-facing body omits access_token / refresh_token (per API Contract).
  return NextResponse.json({}, { status: 200 });
}
