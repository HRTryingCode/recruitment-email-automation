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
  nodeEnv: string;
}

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
  jwtSecret: process.env.JWT_SECRET ?? 'default-dev-secret-change-in-production',
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:5173',
  nodeEnv: process.env.NODE_ENV ?? 'development',
};
