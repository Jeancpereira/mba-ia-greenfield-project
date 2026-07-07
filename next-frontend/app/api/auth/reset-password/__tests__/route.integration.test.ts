import { describe, it, expect, beforeAll } from "vitest";
import { server } from "@/mocks/server";
import { http, HttpResponse } from "msw";
import { env } from "@/lib/env";

let POST: (req: Request) => Promise<Response>;

beforeAll(async () => {
  ({ POST } = await import("@/app/api/auth/reset-password/route"));
});

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/auth/reset-password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/reset-password", () => {
  it("returns 204 with no body for a valid token + password", async () => {
    const res = await POST(
      makeRequest({ token: "valid-token", password: "NewPassw0rd" })
    );
    expect(res.status).toBe(204);
  });

  it("returns 401 with ApiErrorEnvelope for an invalid/expired token (reserved trigger)", async () => {
    const res = await POST(
      makeRequest({ token: "invalid-token", password: "NewPassw0rd" })
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toMatchObject({ statusCode: 401 });
  });

  it("returns 400 with ApiErrorEnvelope for a malformed token (reserved trigger)", async () => {
    const res = await POST(
      makeRequest({ token: "malformed-token", password: "NewPassw0rd" })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ statusCode: 400, error: "VALIDATION_FAILED" });
  });

  it("forwards token + password to the upstream POST body", async () => {
    let received: Record<string, unknown> = {};
    server.use(
      http.post(`${env.API_URL}/auth/reset-password`, async ({ request }) => {
        received = (await request.json()) as Record<string, unknown>;
        return new HttpResponse(null, { status: 204 });
      })
    );

    await POST(makeRequest({ token: "some-token", password: "Secret123" }));
    expect(received).toEqual({ token: "some-token", password: "Secret123" });
  });
});
