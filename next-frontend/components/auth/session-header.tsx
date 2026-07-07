"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { useSession } from "@/hooks/use-session"
import { cn } from "@/lib/utils"

// Minimal session chrome for the root layout — NOT a redesign of the home
// page (out of scope). Shows the signed-in email + a sign-out action when
// authenticated, or a sign-in link when anonymous.
function SessionHeader({ className, ...props }: React.ComponentProps<"header">) {
  const router = useRouter()
  const { isLoggedIn, email } = useSession()
  const [isSigningOut, setIsSigningOut] = React.useState(false)

  async function handleSignOut() {
    setIsSigningOut(true)
    try {
      await fetch("/api/auth/logout", { method: "POST" })
    } finally {
      // Re-render server chrome (including this header) with the cleared session.
      router.refresh()
      setIsSigningOut(false)
    }
  }

  return (
    <header
      data-slot="session-header"
      className={cn(
        "flex w-full items-center justify-end gap-4 border-b border-border px-6 py-3",
        className
      )}
      {...props}
    >
      {isLoggedIn ? (
        <>
          <span className="text-body-md text-muted-foreground">{email}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleSignOut}
            disabled={isSigningOut}
          >
            {isSigningOut ? "Saindo…" : "Sair"}
          </Button>
        </>
      ) : (
        <Link
          href="/login"
          className="text-body-md text-link hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 rounded-[var(--radius-0-5)]"
        >
          Entrar
        </Link>
      )}
    </header>
  )
}

export { SessionHeader }
