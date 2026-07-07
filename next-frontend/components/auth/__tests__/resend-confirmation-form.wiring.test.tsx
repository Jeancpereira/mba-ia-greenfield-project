// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { http, HttpResponse } from "msw"
import { describe, expect, it, vi } from "vitest"

import { server } from "@/mocks/server"
import { ResendConfirmationForm } from "../resend-confirmation-form"

function envelope(statusCode: number, message: string) {
  return { statusCode, error: "ERR", message, code: null }
}

describe("<ResendConfirmationForm /> wiring", () => {
  it("submits a typed payload and shows a generic confirmation on 204", async () => {
    const user = userEvent.setup()
    const received: Record<string, unknown>[] = []
    server.use(
      http.post("/api/auth/resend-confirmation", async ({ request }) => {
        received.push((await request.json()) as Record<string, unknown>)
        return new HttpResponse(null, { status: 204 })
      })
    )

    render(<ResendConfirmationForm />)
    await user.type(
      screen.getByLabelText("Email address"),
      "alice@example.com"
    )
    await user.click(
      screen.getByRole("button", { name: "Resend confirmation email" })
    )

    const status = await screen.findByRole("status")
    expect(status).toHaveTextContent("Verifique seu e-mail")
    expect(received).toEqual([{ email: "alice@example.com" }])
    // No text reveals whether the account exists (anti-enumeration).
    expect(status.textContent ?? "").not.toMatch(
      /não (existe|encontrad)|not found|no account|conta não existe/i
    )
  })

  it("renders the identical confirmation for an unregistered email (anti-enumeration)", async () => {
    const user = userEvent.setup()
    server.use(
      http.post("/api/auth/resend-confirmation", () =>
        new HttpResponse(null, { status: 204 })
      )
    )

    render(<ResendConfirmationForm />)
    await user.type(screen.getByLabelText("Email address"), "nobody@example.com")
    await user.click(
      screen.getByRole("button", { name: "Resend confirmation email" })
    )

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Verifique seu e-mail"
    )
  })

  it("maps a 400 to an inline error on the email field without replacing the form", async () => {
    const user = userEvent.setup()
    server.use(
      http.post("/api/auth/resend-confirmation", () =>
        HttpResponse.json(envelope(400, "Validation failed"), { status: 400 })
      )
    )

    render(<ResendConfirmationForm />)
    await user.type(
      screen.getByLabelText("Email address"),
      "alice@example.com"
    )
    await user.click(
      screen.getByRole("button", { name: "Resend confirmation email" })
    )

    expect(await screen.findByText("Validation failed")).toBeInTheDocument()
    expect(screen.queryByRole("status")).not.toBeInTheDocument()
  })

  it("blocks submit with client-side validation and fires no request until valid", async () => {
    const user = userEvent.setup()
    const onCall = vi.fn()
    server.use(
      http.post("/api/auth/resend-confirmation", () => {
        onCall()
        return new HttpResponse(null, { status: 204 })
      })
    )

    render(<ResendConfirmationForm />)
    await user.click(
      screen.getByRole("button", { name: "Resend confirmation email" })
    )

    expect(
      await screen.findByText("Endereço de e-mail inválido")
    ).toBeInTheDocument()
    expect(onCall).not.toHaveBeenCalled()

    await user.type(
      screen.getByLabelText("Email address"),
      "alice@example.com"
    )
    await user.click(
      screen.getByRole("button", { name: "Resend confirmation email" })
    )

    await waitFor(() => expect(onCall).toHaveBeenCalledTimes(1))
  })
})
