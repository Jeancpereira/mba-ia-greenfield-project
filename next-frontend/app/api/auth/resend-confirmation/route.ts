import { NextResponse } from "next/server";

import type { ResendConfirmationDto, ApiErrorEnvelope } from "@/lib/api/contracts";
import { upstream } from "@/lib/api/upstream";

export async function POST(request: Request) {
  const body = (await request.json()) as ResendConfirmationDto;

  const { error, response } = await upstream.POST("/auth/resend-confirmation", {
    body: body as never,
  });

  if (error) {
    return NextResponse.json<ApiErrorEnvelope>(error as ApiErrorEnvelope, {
      status: response.status,
    });
  }

  // 204 pass-through — identical whether the email exists/is unconfirmed or not (anti-enumeration).
  return new Response(null, { status: 204 });
}
