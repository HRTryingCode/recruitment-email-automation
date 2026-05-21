// Helpers for normalizing EmailMessage rows on the wire.
//
// EmailMessage.toAddresses and EmailMessage.headers are stored as
// JSON-stringified text in a `String` column (see prisma/schema.prisma).
// Until we migrate the column to `Json`, parse on read so clients receive
// real values (string[] / object) instead of a stringified blob.

export function parseToAddresses(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((v): v is string => typeof v === 'string');
  }
  if (typeof raw !== 'string' || raw.length === 0) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((v): v is string => typeof v === 'string');
    }
    return [];
  } catch {
    return [];
  }
}

export function parseHeaders(raw: unknown): Record<string, string> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === 'string') out[k] = v;
    }
    return out;
  }
  if (typeof raw !== 'string' || raw.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === 'string') out[k] = v;
      }
      return out;
    }
    return {};
  } catch {
    return {};
  }
}

type EmailMessageOnWire<T> = Omit<T, 'toAddresses' | 'headers'> & {
  toAddresses: string[];
  headers: Record<string, string>;
};

/**
 * Normalize a single EmailMessage row for API responses: parse the JSON-
 * stringified `toAddresses` and `headers` columns into their real shapes.
 * Returns a new object — does not mutate.
 */
export function serializeEmailMessage<
  T extends { toAddresses?: unknown; headers?: unknown }
>(message: T): EmailMessageOnWire<T> {
  return {
    ...message,
    toAddresses: parseToAddresses(message.toAddresses),
    headers: parseHeaders(message.headers),
  } as EmailMessageOnWire<T>;
}

export function serializeEmailMessages<
  T extends { toAddresses?: unknown; headers?: unknown }
>(messages: T[]): EmailMessageOnWire<T>[] {
  return messages.map(serializeEmailMessage);
}
