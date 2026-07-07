import { AuthFooter } from "@/components/auth/auth-footer"
import { BrandLogo } from "@/components/auth/brand-logo"
import { ResendConfirmationForm } from "@/components/auth/resend-confirmation-form"
import { Card } from "@/components/ui/card"

export default function ResendConfirmationPage() {
  return (
    <main className="flex flex-1 items-center justify-center bg-background px-6 py-10">
      <Card className="w-full max-w-[448px] items-center gap-6 px-6 py-10">
        <BrandLogo size="lg" />

        <h1 className="text-h1 text-foreground text-center">
          Resend confirmation
        </h1>
        <p className="text-body-md text-muted-foreground text-center">
          Enter your email and we&apos;ll resend the confirmation link
        </p>

        <ResendConfirmationForm className="w-full" />

        <AuthFooter
          question="Already confirmed?"
          linkLabel="Sign in"
          linkHref="/login"
        />
      </Card>
    </main>
  )
}
