import { Router, Request, Response, NextFunction } from 'express';
import { processWebhook } from '../services/gmail.service';

const router = Router();

// POST /api/webhooks/gmail - Google Cloud Pub/Sub push endpoint
router.post('/gmail', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Pub/Sub sends data as base64 encoded JSON
    if (!req.body?.message?.data) {
      res.status(200).json({ success: true, message: 'No data' });
      return;
    }

    // Process asynchronously - respond immediately to Pub/Sub
    processWebhook(req.body).catch((err) => {
      console.error('[Webhook] Gmail processing error:', err);
    });

    // Always return 200 to acknowledge receipt
    res.status(200).json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
