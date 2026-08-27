import { Router, raw } from 'express';
import { asyncHandler } from '../../common/utils/async-handler';
import { processWebhook } from './webhook.service';

/**
 * Phase 28 Track B Section 5: the real HTTP entry point for provider
 * webhook delivery — mounted directly on the Express app in app.ts,
 * BEFORE the global `express.json()` body parser, using `express.raw()`
 * instead. This is not a stylistic choice: Stripe's signature is computed
 * over the EXACT raw request bytes, and re-serializing an already-parsed
 * JS object (`JSON.stringify(req.body)`) can legitimately differ in
 * whitespace/key-order from what Stripe actually signed, silently
 * breaking every real signature verification. `outcome` maps to an HTTP
 * status a real provider's retry logic actually understands: 2xx means
 * "never retry" (processed, duplicate, ignored — all real terminal
 * states), 4xx means "the request itself was invalid" (bad signature),
 * 5xx means "please retry" (a genuine, recorded, real processing failure
 * — this exact distinction was a real defect found and fixed this phase,
 * see webhook.service.ts).
 */
export const webhookRouter = Router();

webhookRouter.post(
  '/stripe',
  raw({ type: 'application/json', limit: '1mb' }),
  asyncHandler(async (req, res) => {
    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
    const signature = req.header('stripe-signature') ?? '';
    const result = await processWebhook(rawBody, signature);

    switch (result.outcome) {
      case 'invalid_signature':
        res.status(400).json({ error: 'invalid_signature' });
        return;
      case 'failed':
        // A genuine, recorded processing failure — a 5xx tells Stripe's
        // real retry mechanism to try again later, giving a transient
        // error (e.g. a momentary DB blip) a real chance to recover.
        res.status(500).json({ error: 'processing_failed' });
        return;
      case 'duplicate':
      case 'ignored':
      case 'processed':
        res.status(200).json({ received: true, outcome: result.outcome });
        return;
    }
  })
);
