"use client"

import * as React from "react"
import Link from "next/link"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { z } from "zod"

import { FieldError } from "@/components/auth/field-error"
import { PasswordStrengthMeter } from "@/components/auth/password-strength-meter"
import { PasswordVisibilityToggle } from "@/components/auth/password-visibility-toggle"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { ApiErrorEnvelope } from "@/lib/api/contracts"
import { cn } from "@/lib/utils"

// Password rules mirrored from signup-form (phase-02-auth-frontend/TD-04) —
// `ResetPasswordDto` has no declared properties in the contract source yet.
const resetPasswordSchema = z
  .object({
    password: z
      .string()
      .min(8, "Mínimo 8 caracteres")
      .regex(/[a-zA-Z]/, "Inclua ao menos uma letra")
      .regex(/[0-9]/, "Inclua ao menos um número"),
    confirmPassword: z.string().min(1, "Confirme sua senha"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "As senhas não coincidem",
    path: ["confirmPassword"],
  })

type ResetPasswordValues = z.infer<typeof resetPasswordSchema>

type ResetPasswordFormProps = React.ComponentProps<"form"> & {
  token: string | null
}

function ResetPasswordForm({
  className,
  token,
  ...props
}: ResetPasswordFormProps) {
  const {
    register,
    handleSubmit,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "", confirmPassword: "" },
  })

  const [passwordType, setPasswordType] = React.useState<"password" | "text">(
    "password"
  )
  const [confirmType, setConfirmType] = React.useState<"password" | "text">(
    "password"
  )
  const [reset, setReset] = React.useState(false)

  const passwordValue = watch("password")

  async function onSubmit(values: ResetPasswordValues) {
    if (!token) {
      setError("root.serverError", {
        type: "server",
        message: "Link de redefinição inválido.",
      })
      return
    }

    const res = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password: values.password }),
    })

    if (!res.ok) {
      const envelope = (await res.json()) as ApiErrorEnvelope
      const message = Array.isArray(envelope.message)
        ? envelope.message.join(" ")
        : envelope.message

      if (envelope.statusCode === 401) {
        setError("root.serverError", {
          type: "server",
          message: message || "Link de redefinição inválido ou expirado.",
        })
        return
      }

      setError("root.serverError", { type: "server", message })
      return
    }

    setReset(true)
  }

  if (!token) {
    return (
      <div
        data-slot="reset-password-invalid-token"
        role="alert"
        className={cn(
          "flex w-full flex-col items-center gap-2 text-center",
          className
        )}
      >
        <p className="text-label-lg text-foreground">Link inválido</p>
        <p className="text-body-md text-muted-foreground">
          Este link de redefinição de senha está incompleto ou inválido.
        </p>
      </div>
    )
  }

  if (reset) {
    return (
      <div
        data-slot="reset-password-success"
        role="status"
        className={cn(
          "flex w-full flex-col items-center gap-4 text-center",
          className
        )}
      >
        <p className="text-label-lg text-foreground">Senha redefinida!</p>
        <p className="text-body-md text-muted-foreground">
          Sua senha foi alterada com sucesso.
        </p>
        <Button asChild size="md" className="w-full">
          <Link href="/login">Ir para o login</Link>
        </Button>
      </div>
    )
  }

  return (
    <form
      data-slot="reset-password-form"
      noValidate
      onSubmit={handleSubmit(onSubmit)}
      className={cn("flex w-full flex-col gap-6", className)}
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
        <Label htmlFor="password">New password</Label>
        <div className="relative">
          <Input
            id="password"
            type={passwordType}
            autoComplete="new-password"
            placeholder="Create a new password"
            className="pr-12"
            aria-invalid={!!errors.password}
            {...register("password")}
          />
          <PasswordVisibilityToggle
            onTypeChange={setPasswordType}
            className="absolute inset-y-0 right-2 my-auto"
          />
        </div>
        <PasswordStrengthMeter value={passwordValue} />
        <FieldError message={errors.password?.message} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="confirmPassword">Confirm new password</Label>
        <div className="relative">
          <Input
            id="confirmPassword"
            type={confirmType}
            autoComplete="new-password"
            placeholder="Confirm your new password"
            className="pr-12"
            aria-invalid={!!errors.confirmPassword}
            {...register("confirmPassword")}
          />
          <PasswordVisibilityToggle
            onTypeChange={setConfirmType}
            className="absolute inset-y-0 right-2 my-auto"
          />
        </div>
        <FieldError message={errors.confirmPassword?.message} />
      </div>

      <Button
        type="submit"
        size="md"
        disabled={isSubmitting}
        className="w-full"
      >
        {isSubmitting ? "Redefinindo…" : "Reset password"}
      </Button>
    </form>
  )
}

export { ResetPasswordForm }
