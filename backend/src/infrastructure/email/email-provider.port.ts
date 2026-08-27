/**
 * Phase 33 Track D: a real port/adapter boundary for outbound transactional
 * email (password-reset links today; any future transactional email later),
 * the exact same pattern `AIProviderPort` already established for AI calls
 * — a real interface, a real mock adapter used when no real provider is
 * configured, and a clean seam for a real SMTP/SendGrid/Postmark adapter to
 * be dropped in later without touching any caller.
 *
 * No real email-sending credential exists in this environment — real
 * delivery is `BLOCKED — CREDENTIAL`, honestly, the same way `AI_PROVIDER`
 * defaults to `mock` rather than silently pretending a real OpenAI call
 * happened.
 */
export interface SendEmailParams {
  to: string;
  subject: string;
  body: string;
}

export interface EmailProviderPort {
  sendEmail(params: SendEmailParams): Promise<void>;
}
