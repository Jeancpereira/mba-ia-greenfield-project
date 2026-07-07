"use client"

import * as React from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { z } from "zod"

import { FieldError } from "@/components/auth/field-error"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { ApiErrorEnvelope } from "@/lib/api/contracts"
import { cn } from "@/lib/utils"

// Client-side validation mirror — `ResendConfirmationDto` has no declared
// properties in the contract source yet (same gap as forgot-password).
const resendConfirmationSchema = z.object({
  email: z.email("Endereço de e-mail inválido"),
})

type ResendConfirmationValues = z.infer<typeof resendConfirmationSchema>

function ResendConfirmationForm({
  className,
  ...props
}: React.ComponentProps<"form">) {
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ResendConfirmationValues>({
    resolver: zodResolver(resendConfirmationSchema),
    defaultValues: { email: "" },
  })

  const [sent, setSent] = React.useState(false)

  async function onSubmit(values: ResendConfirmationValues) {
    const res = await fetch("/api/auth/resend-confirmation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: values.email }),
    })

    if (!res.ok) {
      const envelope = (await res.json()) as ApiErrorEnvelope
      const message = Array.isArray(envelope.message)
        ? envelope.message.join(" ")
        : envelope.message

      if (envelope.statusCode === 400) {
        setError("email", { type: "server", message })
        return
      }

      setError("root.serverError", { type: "server", message })
      return
    }

    // Generic response regardless of account state (anti-enumeration).
    setSent(true)
  }

  if (sent) {
    return (
      <div
        data-slot="resend-confirmation-success"
        role="status"
        className={cn(
          "flex w-full flex-col items-center gap-2 text-center",
          className
        )}
      >
        <p className="text-label-lg text-foreground">Verifique seu e-mail</p>
        <p className="text-body-md text-muted-foreground">
          Se existir uma conta não confirmada com esse endereço, enviamos um
          novo e-mail de confirmação.
        </p>
      </div>
    )
  }

  return (
    <form
      data-slot="resend-confirmation-form"
      noValidate
      onSubmit={handleSubmit(onSubmit)}
      className={cn("flex w-full flex-col gap-4", className)}
      {...props}
    >
      {errors.root?.serverError?.message && (
        <p
          role="alert"
          className="text-caption text-destructive"
          data-slot="form-error"
        >
          {errors.root.serverError.message}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email address</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          placeholder="Enter your email"
          aria-invalid={!!errors.email}
          {...register("email")}
        />
        <FieldError message={errors.email?.message} />
      </div>

      <Button type="submit" size="md" disabled={isSubmitting} className="w-full">
        {isSubmitting ? "Sending…" : "Resend confirmation email"}
      </Button>
    </form>
  )
}

export { ResendConfirmationForm }
