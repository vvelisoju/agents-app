// SEC-17 — fail fast at boot if a required secret is missing in production, so a
// misconfigured deploy dies loudly instead of running with insecure dev defaults
// (dev widget/encryption keys, reflect-any CORS, etc.).
const REQUIRED_IN_PROD = [
  'DATABASE_URL',
  'ANTHROPIC_API_KEY',
  'ENCRYPTION_KEY', // SEC-1 secret-at-rest
  'WIDGET_SIGNING_SECRET', // FND-12 widget keys
  'CORS_ORIGIN', // FND-19 non-reflecting CORS
];

export function assertProdSecrets(): void {
  if (process.env.NODE_ENV !== 'production') return;
  const missing = REQUIRED_IN_PROD.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(
      `FATAL: missing required production environment variables: ${missing.join(', ')}. ` +
        `Refusing to start. Set them (see server/.env.production.example).`,
    );
  }
}
