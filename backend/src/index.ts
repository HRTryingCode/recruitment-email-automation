import { config } from './config';
import app from './app';
import { prisma } from './db/client';
import { renewGmailWatches } from './services/gmail.service';

async function startServer() {
  try {
    // Test DB connection
    await prisma.$connect();
    console.log('[DB] Connected to PostgreSQL');

    // Gmail watch renewal cron.
    //
    // On Vercel (serverless), `setInterval` doesn't run between invocations.
    // We rely on Vercel Cron hitting POST /api/internal/cron/renew-watches
    // instead (see vercel.json). Locally, keep the in-process timer so dev
    // boxes still renew watches.
    if (!process.env.VERCEL) {
      setInterval(
        async () => {
          try {
            await renewGmailWatches();
          } catch (err) {
            console.error('[Cron] Gmail watch renewal failed:', err);
          }
        },
        6 * 60 * 60 * 1000
      );

      // Initial watch renewal on startup
      renewGmailWatches().catch((err) =>
        console.warn('[Cron] Initial Gmail watch renewal failed:', err)
      );
    }

    app.listen(config.port, () => {
      console.log(
        `[Server] Running on http://localhost:${config.port} (${config.nodeEnv})`
      );
    });
  } catch (err) {
    console.error('[Server] Failed to start:', err);
    process.exit(1);
  }
}

startServer();
