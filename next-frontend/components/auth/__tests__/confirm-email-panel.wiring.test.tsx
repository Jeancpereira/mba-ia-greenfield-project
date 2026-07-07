// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react"
import { http, HttpResponse } from "msw"
import { describe, expect, it } from "vitest"

import { server } from "@/mocks/server"
import { ConfirmEmailPanel } from "../confirm-email-panel"

function envelope(statusCode: number, message: string) {
  return { statusCode, error: "ERR", message, code: null }
}

describe("<ConfirmEmailPanel /> wiring", () => {
  it("renders an error immediately when there is no token, firing no request", () => {
    render(<ConfirmEmailPanel token={null} />)

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Link de confirmação inválido."
    )
  })

  it("POSTs the token on mount and shows success on 204", async () => {
    let receivedBody: Record<string, unknown> = {}
    server.use(
      http.post("/api/auth/confirm-email", async ({ request }) => {
        receivedBody = (await request.json()) as Record<string, unknown>
        return new HttpResponse(null, { status: 204 })
      })
    )

    render(<ConfirmEmailPanel token="valid-token" />)

    expect(screen.getByRole("status")).toHaveTextContent(
      "Confirmando seu e-mail…"
    )

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "E-mail confirmado!"
      )
    )
    expect(receivedBody).toEqual({ token: "valid-token" })
    expect(
      screen.getByRole("link", { name: "Ir para o login" })
    ).toHaveAttribute("href", "/login")
  })

  it("shows an error with a resend CTA when the token is invalid/expired (401)", async () => {
    server.use(
      http.post("/api/auth/confirm-email", () =>
        HttpResponse.json(
          envelope(401, "Invalid or expired confirmation token"),
          { status: 401 }
        )
      )
    )

    render(<ConfirmEmailPanel token="invalid-token" />)

    expect(
      await screen.findByText("Invalid or expired confirmation token")
    ).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "Reenviar e-mail de confirmação" })
    ).toHaveAttribute("href", "/resend-confirmation")
  })
})
