import { describe, it, expect, beforeAll } from "vitest";
import { server } from "@/mocks/server";
import { http, HttpResponse } from "msw";
import { env } from "@/lib/env";

let POST: (req: Request) => Promise<Response>;

beforeAll(async () => {
  ({ POST } = await import("@/app/api/auth/confirm-email/route"));
});

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/auth/confirm-email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/confirm-email", () => {
  it("returns 204 with no body for a valid token", async () => {
    const res = await POST(makeRequest({ token: "valid-token" }));
    expect(res.status).toBe(204);
  });

  it("returns 401 with ApiErrorEnvelope for an invalid/expired token (reserved trigger)", async () => {
    const res = await POST(makeRequest({ token: "invalid-token" }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toMatchObject({ statusCode: 401 });
  });

  it("returns 400 with ApiErrorEnvelope for a malformed token (reserved trigger)", async () => {
    const res = await POST(makeRequest({ token: "malformed-token" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ statusCode: 400, error: "VALIDATION_FAILED" });
  });

  it("forwards the token to the upstream GET as a query param", async () => {
    let receivedToken: string | null = null;
    server.use(
      http.get(`${env.API_URL}/auth/confirm-email`, ({ request }) => {
        receivedToken = new URL(request.url).searchParams.get("token");
        return new HttpResponse(null, { status: 204 });
      })
    );

    await POST(makeRequest({ token: "some-token-abc" }));
    expect(receivedToken).toBe("some-token-abc");
  });
});
