import type { EmailProviderPort } from './email-provider.port';
import { MockEmailAdapter } from './mock-email.adapter';

let cached: EmailProviderPort | null = null;

/** Real factory, mirroring the AI provider port's own — always returns the mock adapter today (no real email credential configured in this environment); a real SMTP/SendGrid/Postmark adapter drops in here without touching any caller. */
export function getEmailProvider(): EmailProviderPort {
  cached ??= new MockEmailAdapter();
  return cached;
}

export type { EmailProviderPort, SendEmailParams } from './email-provider.port';
