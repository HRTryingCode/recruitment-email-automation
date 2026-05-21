import dotenv from 'dotenv';
dotenv.config();

interface Config {
  port: number;
  databaseUrl: string;
  anthropicApiKey: string;
  gmail: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    pubsubTopic: string;
  };
  azure: {
    clientId: string;
    clientSecret: string;
    tenantId: string;
  };
  jwtSecret: string;
  frontendUrl: string;
  allowedOrigins: string[];
  nodeEnv: string;
  draftCcEmail: string;
}

const PLACEHOLDER_JWT_SECRET = 'default-dev-secret-change-in-production';

// Production Vercel origin used when ALLOWED_ORIGINS is unset, so a misconfigured
// deploy fails closed (only the prod origin) rather than open.
const DEFAULT_PROD_ORIGIN = 'https://recruiting-email-automation-api.vercel.app';

function parseAllowedOrigins(raw: string | undefined): string[] {
  if (!raw || raw.trim() === '') return [DEFAULT_PROD_ORIGIN];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// Fail-fast env validation. Runs once at module load — config.ts is imported
// by index.ts before app.listen, so any throw here surfaces during cold-start
// and Vercel's function will return 5xx until the deployment is fixed (which
// is what we want: better a loud 500 than a silently mis-encrypted token).
//
// Policy:
//   - On Vercel (process.env.VERCEL set): missing vars / placeholder secrets
//     are hard errors.
//   - In local dev: warn so the developer notices but still boots.
function validateEnv(): void {
  const required = [
    'POSTGRES_PRISMA_URL',
    'POSTGRES_URL_NON_POOLING',
    'ANTHROPIC_API_KEY',
    'JWT_SECRET',
    'ENCRYPTION_KEY',
    'CRON_SECRET',
    'GMAIL_CLIENT_ID',
    'GMAIL_CLIENT_SECRET',
  ];

  const missing = required.filter((k) => !process.env[k] || process.env[k] === '');
  const problems: string[] = [];

  for (const k of missing) {
    problems.push(`missing required env var: ${k}`);
  }

  if (process.env.JWT_SECRET === PLACEHOLDER_JWT_SECRET) {
    problems.push(
      `JWT_SECRET is set to the placeholder default — generate a real secret (>= 32 random bytes)`
    );
  }

  // On Vercel, the Pub/Sub webhook MUST be JWT-verified — otherwise anyone
  // who knows the public webhook URL can trigger Gmail history fetches. Local
  // dev is allowed to leave it unset (the verifier becomes a no-op).
  if (
    process.env.VERCEL &&
    (!process.env.PUBSUB_AUDIENCE || process.env.PUBSUB_AUDIENCE === '')
  ) {
    problems.push(
      `PUBSUB_AUDIENCE is required on Vercel — without it the Gmail webhook accepts unsigned POSTs (see backend/src/routes/webhooks.ts).`
    );
  }

  const encKey = process.env.ENCRYPTION_KEY;
  if (encKey) {
    let decodedLen = 0;
    try {
      decodedLen = Buffer.from(encKey, 'base64').length;
    } catch {
      decodedLen = 0;
    }
    if (decodedLen < 32) {
      problems.push(
        `ENCRYPTION_KEY must decode to at least 32 bytes (got ${decodedLen}); generate with: openssl rand -base64 32`
      );
    }
  }

  if (problems.length === 0) return;

  const summary = problems.map((p) => `  - ${p}`).join('\n');

  if (process.env.VERCEL) {
    throw new Error(
      `[config] Refusing to start on Vercel with invalid environment:\n${summary}`
    );
  }

  console.warn(
    `[config] Environment problems detected (would block startup on Vercel):\n${summary}`
  );
}

validateEnv();

export const config: Config = {
  port: parseInt(process.env.PORT ?? '3001', 10),
  databaseUrl: process.env.POSTGRES_PRISMA_URL ?? '',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
  gmail: {
    clientId: process.env.GMAIL_CLIENT_ID ?? '',
    clientSecret: process.env.GMAIL_CLIENT_SECRET ?? '',
    redirectUri:
      process.env.GMAIL_REDIRECT_URI ??
      'http://localhost:3001/api/mailboxes/gmail/callback',
    pubsubTopic: process.env.GMAIL_PUBSUB_TOPIC ?? '',
  },
  azure: {
    clientId: process.env.AZURE_CLIENT_ID ?? '',
    clientSecret: process.env.AZURE_CLIENT_SECRET ?? '',
    tenantId: process.env.AZURE_TENANT_ID ?? '',
  },
  jwtSecret: process.env.JWT_SECRET ?? PLACEHOLDER_JWT_SECRET,
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:5173',
  allowedOrigins: parseAllowedOrigins(process.env.ALLOWED_ORIGINS),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  draftCcEmail: process.env.DRAFT_CC_EMAIL ?? 'sofia@archive.com',
};
