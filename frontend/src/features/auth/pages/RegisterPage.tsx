import type { JSX } from 'react';
import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, FormHelperText } from '@/shared/components/ui';
import { Alert } from '@/shared/components/feedback';
import { useAuth } from '@/app/providers/AuthProvider';
import { register as registerRequest } from '@/features/auth/api/auth.api';
import { registerFormSchema, type RegisterFormValues } from '@/features/auth/schemas/auth.schemas';
import { getApiErrorMessage } from '@/shared/lib/api-client';
import { useDocumentTitle } from '@/shared/hooks/useDocumentTitle';

export function RegisterPage(): JSX.Element {
  useDocumentTitle('Qeydiyyat');
  const navigate = useNavigate();
  const { login: setAuth } = useAuth();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormValues>({ resolver: zodResolver(registerFormSchema) });

  const onSubmit = async (values: RegisterFormValues): Promise<void> => {
    setSubmitError(null);
    try {
      const result = await registerRequest(values);
      setAuth({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        userId: result.user.id,
        email: result.user.email,
        fullName: result.user.fullName,
        workspaceId: null,
        isSystemAdmin: result.user.isSystemAdmin,
      });
      void navigate('/onboarding');
    } catch (err) {
      setSubmitError(getApiErrorMessage(err));
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-secondary px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>BizPilot AI-də qeydiyyatdan keçin</CardTitle>
          <CardDescription>Biznesinizi anlayan AI köməkçinizi indi qurun.</CardDescription>
        </CardHeader>
        <CardContent>
          {submitError ? (
            <Alert variant="danger" className="mb-4" onDismiss={() => { setSubmitError(null); }}>
              {submitError}
            </Alert>
          ) : null}
          <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="flex flex-col gap-4" noValidate>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="fullName">Ad Soyad</Label>
              <Input id="fullName" autoComplete="name" invalid={Boolean(errors.fullName)} {...register('fullName')} />
              {errors.fullName ? <FormHelperText variant="error">{errors.fullName.message}</FormHelperText> : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="email" invalid={Boolean(errors.email)} {...register('email')} />
              {errors.email ? <FormHelperText variant="error">{errors.email.message}</FormHelperText> : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">Şifrə</Label>
              <Input id="password" type="password" autoComplete="new-password" invalid={Boolean(errors.password)} {...register('password')} />
              {errors.password ? <FormHelperText variant="error">{errors.password.message}</FormHelperText> : null}
            </div>
            <Button type="submit" isLoading={isSubmitting} className="mt-2">
              Hesab yarat
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            Artıq hesabınız var?{' '}
            <Link to="/login" className="text-primary underline-offset-4 hover:underline">
              Daxil olun
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
