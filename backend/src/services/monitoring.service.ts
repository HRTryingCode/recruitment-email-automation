import { prisma } from '../db/client';
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';

// Keys whose values get fully replaced with [REDACTED] regardless of contents.
// SystemLog.details is readable by any authenticated user via the internal
// health/status endpoints, so we strip anything whose key suggests a secret.
const SECRET_KEY_RE = /(password|token|credential|secret)/i;

// Replace a `stack` string with just the first line (the error message) so
// downstream readers still get the gist without leaking file paths,
// dependency versions, or message bodies that v8 sometimes inlines into the
// stack frame. Returning `…(stack redacted)` makes the redaction visible.
function redactStack(stack: unknown): string {
  if (typeof stack !== 'string') return '…(stack redacted)';
  const firstLine = stack.split('\n', 1)[0]?.trim() ?? '';
  return firstLine ? `${firstLine} …(stack redacted)` : '…(stack redacted)';
}

export function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(value, (key, val) => {
      if (key && SECRET_KEY_RE.test(key)) return '[REDACTED]';
      if (key === 'stack') return redactStack(val);
      if (typeof val === 'object' && val !== null) {
        if (seen.has(val as object)) return '[Circular]';
        seen.add(val as object);
      }
      if (typeof val === 'bigint') return val.toString();
      if (val instanceof Error) {
        return {
          name: val.name,
          message: val.message,
          // Pass through unmodified — the `stack` branch above will redact it
          // when JSON.stringify recurses into this object. Keeping the field
          // present (rather than dropping it) preserves the shape consumers
          // expect when reading recentLogs.
          stack: val.stack,
        };
      }
      return val;
    });
  } catch {
    return '{"_serializationError":"unstringifiable"}';
  }
}

export async function logEvent(
  event: string,
  details: Record<string, unknown>,
  level: string = 'INFO'
): Promise<void> {
  try {
    await prisma.systemLog.create({
      data: { event, details: safeStringify(details), level },
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

  // Check Claude API — key shape and client init.
  // We don't make an actual API call to keep health checks fast and cheap;
  // instead we validate the key has the expected sk-ant-* shape and that
  // the SDK can instantiate. Real reachability is exercised by every draft
  // generation, which will surface failure via the SystemLog WARN path.
  let claudeAvailable = false;
  try {
    const key = config.anthropicApiKey;
    const keyShapeOk = typeof key === 'string' && /^sk-ant-/.test(key) && key.length > 30;
    if (keyShapeOk) {
      const client = new Anthropic({ apiKey: key });
      claudeAvailable = !!client;
    }
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
