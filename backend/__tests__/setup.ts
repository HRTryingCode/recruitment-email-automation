// Test-wide setup: ensure env vars our modules read at import time have safe
// defaults so individual tests don't have to remember.
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-jwt-secret';
// Default key (base64 of 32 bytes). Individual crypto tests may override.
process.env.ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY ?? 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? 'test-anthropic-key';
// Route integration tests instantiate google-auth-library.OAuth2Client with
// config.gmail.clientId; an empty value flips /api/auth/google to a 500
// "Google sign-in is not configured" branch before our mocks see the request.
process.env.GMAIL_CLIENT_ID = process.env.GMAIL_CLIENT_ID ?? 'test-gmail-client-id';
process.env.GMAIL_CLIENT_SECRET =
  process.env.GMAIL_CLIENT_SECRET ?? 'test-gmail-client-secret';
