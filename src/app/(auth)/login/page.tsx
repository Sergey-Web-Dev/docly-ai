import { signIn } from '@/app/(auth)/actions';
import { AuthForm } from '@/components/auth-form';

export default function LoginPage(): React.ReactElement {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-muted/40 px-4">
      <AuthForm mode="login" action={signIn} />
    </main>
  );
}
