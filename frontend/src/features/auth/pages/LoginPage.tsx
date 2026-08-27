import type { JSX } from 'react';
import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, FormHelperText } from '@/shared/components/ui';
import { Alert } from '@/shared/components/feedback';
import { useAuth } from '@/app/providers/AuthProvider';
import { login as loginRequest } from '@/features/auth/api/auth.api';
import { loginFormSchema, type LoginFormValues } from '@/features/auth/schemas/auth.schemas';
import { getApiErrorMessage } from '@/shared/lib/api-client';
import { listMyWorkspaces, selectWorkspace } from '@/features/onboarding/api/onboarding.api';
import { useDocumentTitle } from '@/shared/hooks/useDocumentTitle';

export function LoginPage(): JSX.Element {
  useDocumentTitle('Daxil olun');
  const navigate = useNavigate();
  const { login: setAuth, setWorkspace } = useAuth();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({ resolver: zodResolver(loginFormSchema) });

  const onSubmit = async (values: LoginFormValues): Promise<void> => {
    setSubmitError(null);
    try {
      const result = await loginRequest(values);
      setAuth({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        userId: result.user.id,
        email: result.user.email,
        fullName: result.user.fullName,
        workspaceId: null,
        isSystemAdmin: result.user.isSystemAdmin,
      });

      // Phase 18: a returning user already has a workspace — resolve back
      // into it rather than sending every login through onboarding again
      // (which would create a duplicate workspace). Only a genuinely new
      // user, with zero workspaces, goes to onboarding.
      const workspaces = await listMyWorkspaces();
      const existing = workspaces[0];
      if (existing) {
        const selected = await selectWorkspace(existing.id);
        setWorkspace(selected.workspace.id, selected.accessToken);
        void navigate('/');
      } else {
        void navigate('/onboarding');
      }
    } catch (err) {
      setSubmitError(getApiErrorMessage(err));
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-secondary px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>BizPilot AI-ə daxil olun</CardTitle>
          <CardDescription>Biznesinizin AI köməkçisinə xoş gəlmisiniz.</CardDescription>
        </CardHeader>
        <CardContent>
          {submitError ? (
            <Alert variant="danger" className="mb-4" onDismiss={() => { setSubmitError(null); }}>
              {submitError}
            </Alert>
          ) : null}
          <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="flex flex-col gap-4" noValidate>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="email" invalid={Boolean(errors.email)} {...register('email')} />
              {errors.email ? <FormHelperText variant="error">{errors.email.message}</FormHelperText> : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">Şifrə</Label>
              <Input id="password" type="password" autoComplete="current-password" invalid={Boolean(errors.password)} {...register('password')} />
              {errors.password ? <FormHelperText variant="error">{errors.password.message}</FormHelperText> : null}
            </div>
            <Button type="submit" isLoading={isSubmitting} className="mt-2">
              Daxil ol
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            Hesabınız yoxdur?{' '}
            <Link to="/register" className="text-primary underline-offset-4 hover:underline">
              Qeydiyyatdan keçin
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
