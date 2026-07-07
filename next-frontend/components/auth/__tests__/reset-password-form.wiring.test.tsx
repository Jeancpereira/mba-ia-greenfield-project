// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { http, HttpResponse } from "msw"
import { describe, expect, it, vi } from "vitest"

import { server } from "@/mocks/server"
import { ResetPasswordForm } from "../reset-password-form"

function envelope(statusCode: number, message: string) {
  return { statusCode, error: "ERR", message, code: null }
}

async function fillValid(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("New password"), "Secret123")
  await user.type(screen.getByLabelText("Confirm new password"), "Secret123")
}

describe("<ResetPasswordForm /> wiring", () => {
  it("renders an invalid-link message when there is no token, without rendering the form", () => {
    render(<ResetPasswordForm token={null} />)

    expect(screen.getByRole("alert")).toHaveTextContent("Link inválido")
    expect(
      screen.queryByRole("button", { name: "Reset password" })
    ).not.toBeInTheDocument()
  })

  it("submits token + password and replaces the form with a success message on 204", async () => {
    const user = userEvent.setup()
    const received: Record<string, unknown>[] = []
    server.use(
      http.post("/api/auth/reset-password", async ({ request }) => {
        received.push((await request.json()) as Record<string, unknown>)
        return new HttpResponse(null, { status: 204 })
      })
    )

    render(<ResetPasswordForm token="valid-token" />)
    await fillValid(user)
    await user.click(screen.getByRole("button", { name: "Reset password" }))

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Senha redefinida!"
      )
    )
    expect(received).toEqual([
      { token: "valid-token", password: "Secret123" },
    ])
    expect(
      screen.getByRole("link", { name: "Ir para o login" })
    ).toHaveAttribute("href", "/login")
  })

  it("maps a 401 to a form-level invalid/expired-token alert", async () => {
    const user = userEvent.setup()
    server.use(
      http.post("/api/auth/reset-password", () =>
        HttpResponse.json(
          envelope(401, "Link de redefinição inválido ou expirado."),
          { status: 401 }
        )
      )
    )

    render(<ResetPasswordForm token="invalid-token" />)
    await fillValid(user)
    await user.click(screen.getByRole("button", { name: "Reset password" }))

    expect(
      await screen.findByText("Link de redefinição inválido ou expirado.")
    ).toBeInTheDocument()
  })

  it("blocks submit with client-side validation and fires no request until valid", async () => {
    const user = userEvent.setup()
    const onCall = vi.fn()
    server.use(
      http.post("/api/auth/reset-password", () => {
        onCall()
        return new HttpResponse(null, { status: 204 })
      })
    )

    render(<ResetPasswordForm token="valid-token" />)
    await user.click(screen.getByRole("button", { name: "Reset password" }))

    expect(await screen.findByText("Mínimo 8 caracteres")).toBeInTheDocument()
    expect(onCall).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText("New password"), "Secret123")
    await user.type(screen.getByLabelText("Confirm new password"), "Different1")
    await user.click(screen.getByRole("button", { name: "Reset password" }))

    expect(
      await screen.findByText("As senhas não coincidem")
    ).toBeInTheDocument()
    expect(onCall).not.toHaveBeenCalled()
  })
})
