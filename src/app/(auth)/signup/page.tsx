import { signUp } from '@/app/(auth)/actions';
import { AuthForm } from '@/components/auth-form';

export default function SignupPage(): React.ReactElement {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <AuthForm mode="signup" action={signUp} />
    </main>
  );
}
