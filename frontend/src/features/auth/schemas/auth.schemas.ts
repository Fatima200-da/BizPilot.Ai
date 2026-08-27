import { z } from 'zod';

export const registerFormSchema = z.object({
  fullName: z.string().min(1, 'Adınızı daxil edin'),
  email: z.string().email('Düzgün email daxil edin'),
  password: z.string().min(8, 'Şifrə ən azı 8 simvol olmalıdır'),
});

export const loginFormSchema = z.object({
  email: z.string().email('Düzgün email daxil edin'),
  password: z.string().min(1, 'Şifrəni daxil edin'),
});

export type RegisterFormValues = z.infer<typeof registerFormSchema>;
export type LoginFormValues = z.infer<typeof loginFormSchema>;
