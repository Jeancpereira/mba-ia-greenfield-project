"use client"

import * as React from "react"
import Link from "next/link"

import { Button } from "@/components/ui/button"
import type { ApiErrorEnvelope } from "@/lib/api/contracts"
import { cn } from "@/lib/utils"

type ConfirmState = "idle" | "confirming" | "success" | "error"

type ConfirmEmailPanelProps = {
  token: string | null
  className?: string
}

// The confirmation POST is triggered from this client-side effect — never
// from a bare <Link>/GET on `/api/auth/confirm-email` — because email
// clients (Outlook, Gmail image/link scanners, etc.) prefetch GET links to
// scan them for safety, which would silently burn a single-use confirmation
// token before the user ever opens the page. Routing the trigger through a
// POST fired by the rendered page (not a hyperlink) avoids that side effect.
function ConfirmEmailPanel({ token, className }: ConfirmEmailPanelProps) {
  const [state, setState] = React.useState<ConfirmState>(
    token ? "confirming" : "error"
  )
  const [errorMessage, setErrorMessage] = React.useState<string>(
    token ? "" : "Link de confirmação inválido."
  )

  React.useEffect(() => {
    if (!token) return

    let cancelled = false

    async function confirm() {
      const res = await fetch("/api/auth/confirm-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      })

      if (cancelled) return

      if (!res.ok) {
        const envelope = (await res.json()) as ApiErrorEnvelope
        const message = Array.isArray(envelope.message)
          ? envelope.message.join(" ")
          : envelope.message
        setErrorMessage(message || "Token de confirmação inválido ou expirado.")
        setState("error")
        return
      }

      setState("success")
    }

    void confirm()

    return () => {
      cancelled = true
    }
  }, [token])

  if (state === "confirming") {
    return (
      <div
        data-slot="confirm-email-confirming"
        role="status"
        className={cn(
          "flex w-full flex-col items-center gap-2 text-center",
          className
        )}
      >
        <p className="text-label-lg text-foreground">Confirmando seu e-mail…</p>
      </div>
    )
  }

  if (state === "success") {
    return (
      <div
        data-slot="confirm-email-success"
        role="status"
        className={cn(
          "flex w-full flex-col items-center gap-4 text-center",
          className
        )}
      >
        <p className="text-label-lg text-foreground">E-mail confirmado!</p>
        <p className="text-body-md text-muted-foreground">
          Sua conta está ativa. Você já pode entrar.
        </p>
        <Button asChild size="md" className="w-full">
          <Link href="/login">Ir para o login</Link>
        </Button>
      </div>
    )
  }

  return (
    <div
      data-slot="confirm-email-error"
      role="alert"
      className={cn(
        "flex w-full flex-col items-center gap-4 text-center",
        className
      )}
    >
      <p className="text-label-lg text-foreground">Não foi possível confirmar</p>
      <p className="text-body-md text-muted-foreground">{errorMessage}</p>
      <Button asChild size="md" className="w-full">
        <Link href="/resend-confirmation">Reenviar e-mail de confirmação</Link>
      </Button>
    </div>
  )
}

export { ConfirmEmailPanel }
