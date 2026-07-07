import { AuthFooter } from "@/components/auth/auth-footer"
import { BrandLogo } from "@/components/auth/brand-logo"
import { ConfirmEmailPanel } from "@/components/auth/confirm-email-panel"
import { Card } from "@/components/ui/card"

type ConfirmEmailPageProps = {
  searchParams: Promise<{ token?: string }>
}

export default async function ConfirmEmailPage({
  searchParams,
}: ConfirmEmailPageProps) {
  const { token } = await searchParams

  return (
    <main className="flex flex-1 items-center justify-center bg-background px-6 py-10">
      <Card className="w-full max-w-[448px] items-center gap-6 px-6 py-10">
        <BrandLogo size="lg" />

        <h1 className="text-h1 text-foreground text-center">Confirm e-mail</h1>

        <ConfirmEmailPanel token={token ?? null} className="w-full" />

        <AuthFooter
          question="Já confirmou?"
          linkLabel="Entrar"
          linkHref="/login"
        />
      </Card>
    </main>
  )
}
