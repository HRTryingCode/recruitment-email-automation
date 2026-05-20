import { prisma } from '../db/client';
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import { Prisma } from '@prisma/client';
import type { LogLevel } from '@prisma/client';

export async function logEvent(
  event: string,
  details: Record<string, unknown>,
  level: LogLevel = 'INFO'
): Promise<void> {
  try {
    await prisma.systemLog.create({
      data: { event, details: details as Prisma.InputJsonValue, level },
    });
  } catch (err) {
    console.error('[Monitoring] Failed to log event:', err);
  }
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  database: { connected: boolean; latencyMs?: number };
  claude: { available: boolean };
  mailboxes: Array<{
    id: string;
    emailAddress: string;
    provider: string;
    isActive: boolean;
    watchExpiry?: Date | null;
  }>;
  recentLogs: Array<{
    id: string;
    event: string;
    level: string;
    createdAt: Date;
    details: unknown;
  }>;
}

export async function checkHealth(): Promise<HealthStatus> {
  // Check DB
  let dbConnected = false;
  let dbLatency: number | undefined;

  try {
    const start = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    dbLatency = Date.now() - start;
    dbConnected = true;
  } catch {
    dbConnected = false;
  }

  // Check Claude API
  let claudeAvailable = false;
  try {
    const client = new Anthropic({ apiKey: config.anthropicApiKey });
    // Just verify the key is set and client initializes
    claudeAvailable = !!config.anthropicApiKey && !!client;
  } catch {
    claudeAvailable = false;
  }

  // Get mailbox statuses
  let mailboxes: HealthStatus['mailboxes'] = [];
  try {
    const mbs = await prisma.mailbox.findMany({
      select: {
        id: true,
        emailAddress: true,
        provider: true,
        isActive: true,
        watchExpiry: true,
      },
    });
    mailboxes = mbs;
  } catch {
    // DB might be down
  }

  // Recent logs
  let recentLogs: HealthStatus['recentLogs'] = [];
  try {
    recentLogs = await prisma.systemLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  } catch {
    // DB might be down
  }

  const status: HealthStatus['status'] =
    !dbConnected ? 'unhealthy' : !claudeAvailable ? 'degraded' : 'healthy';

  return {
    status,
    database: { connected: dbConnected, latencyMs: dbLatency },
    claude: { available: claudeAvailable },
    mailboxes,
    recentLogs,
  };
}
