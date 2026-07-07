// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { http, HttpResponse } from "msw"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { SessionProvider } from "@/components/auth/session-provider"
import type { SessionState } from "@/components/auth/session-provider"
import { server } from "@/mocks/server"
import { SessionHeader } from "../session-header"

const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}))

beforeEach(() => {
  refreshMock.mockClear()
})

function renderWithSession(session: SessionState) {
  return render(
    <SessionProvider initialSession={session}>
      <SessionHeader />
    </SessionProvider>
  )
}

describe("<SessionHeader /> wiring", () => {
  it("shows a sign-in link when anonymous", () => {
    renderWithSession({
      userId: "",
      email: "",
      channelSlug: "",
      isLoggedIn: false,
    })

    expect(screen.getByRole("link", { name: "Entrar" })).toHaveAttribute(
      "href",
      "/login"
    )
    expect(
      screen.queryByRole("button", { name: /Sair/i })
    ).not.toBeInTheDocument()
  })

  it("shows the email and a sign-out button when authenticated", async () => {
    const user = userEvent.setup()
    let logoutCalled = false
    server.use(
      http.post("/api/auth/logout", () => {
        logoutCalled = true
        return new HttpResponse(null, { status: 204 })
      })
    )

    renderWithSession({
      userId: "user-1",
      email: "alice@example.com",
      channelSlug: "alice",
      isLoggedIn: true,
    })

    expect(screen.getByText("alice@example.com")).toBeInTheDocument()
    const signOutButton = screen.getByRole("button", { name: "Sair" })

    await user.click(signOutButton)

    await waitFor(() => expect(logoutCalled).toBe(true))
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1))
  })
})
