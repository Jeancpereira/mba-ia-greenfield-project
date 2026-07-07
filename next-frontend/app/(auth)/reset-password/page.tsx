import { AuthFooter } from "@/components/auth/auth-footer"
import { BrandLogo } from "@/components/auth/brand-logo"
import { ResetPasswordForm } from "@/components/auth/reset-password-form"
import { Card } from "@/components/ui/card"

type ResetPasswordPageProps = {
  searchParams: Promise<{ token?: string }>
}

export default async function ResetPasswordPage({
  searchParams,
}: ResetPasswordPageProps) {
  const { token } = await searchParams

  return (
    <main className="flex flex-1 items-center justify-center bg-background px-6 py-10">
      <Card className="w-full max-w-[448px] items-center gap-6 px-6 py-10">
        <BrandLogo size="lg" />

        <h1 className="text-h1 text-foreground text-center">Reset password</h1>
        <p className="text-body-md text-muted-foreground text-center">
          Choose a new password for your account
        </p>

        <ResetPasswordForm token={token ?? null} className="w-full" />

        <AuthFooter
          question="Remember your password?"
          linkLabel="Sign in"
          linkHref="/login"
        />
      </Card>
    </main>
  )
}
