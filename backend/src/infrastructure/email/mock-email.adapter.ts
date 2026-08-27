import type { EmailProviderPort, SendEmailParams } from './email-provider.port';

/**
 * The real, active adapter whenever no real email-sending credential is
 * configured (currently: always, in this environment — see the Phase 33
 * certification doc's `BLOCKED — CREDENTIAL` note). Never claims to have
 * sent a real email; logs the real content it WOULD have sent, at `info`
 * level, structured, so a developer/test can observe the real reset link
 * without a real inbox — the same honest-mock discipline
 * `MockProviderAdapter` already established for AI calls.
 */
export class MockEmailAdapter implements EmailProviderPort {
  async sendEmail(params: SendEmailParams): Promise<void> {
    console.log(JSON.stringify({ level: 'info', event: 'email.mock_sent', to: params.to, subject: params.subject, body: params.body, timestamp: new Date().toISOString() }));
    await Promise.resolve();
  }
}
