export interface AppConfig {
  databaseUrl: string;
  port: number;
  jwtSecret: string;
  devLogin: boolean;
  webOrigin: string;
  googleMapsApiKey?: string;
  estimateCacheTtlMin: number;
  reminderWebhookUrl?: string;
  oidc?: { issuer: string; clientId: string; clientSecret?: string; redirectUri: string };
  hrApi?: { url: string; token?: string };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const jwtSecret = env.JWT_SECRET ?? (env.NODE_ENV === 'production' ? '' : 'dev-only-insecure-secret-change-me');
  if (!jwtSecret || jwtSecret.length < 32) {
    throw new Error('JWT_SECRET must be set to at least 32 characters');
  }
  return {
    databaseUrl: env.DATABASE_URL ?? 'postgres://madar:madar@localhost:5432/madar',
    port: Number(env.PORT ?? 4100),
    jwtSecret,
    devLogin: env.AUTH_DEV_LOGIN === 'true' || (env.NODE_ENV !== 'production' && env.AUTH_DEV_LOGIN !== 'false'),
    webOrigin: env.WEB_ORIGIN ?? 'http://localhost:3100',
    googleMapsApiKey: env.GOOGLE_MAPS_API_KEY || undefined,
    estimateCacheTtlMin: Number(env.ESTIMATE_CACHE_TTL_MIN ?? 60),
    reminderWebhookUrl: env.REMINDER_WEBHOOK_URL || undefined,
    oidc: env.OIDC_ISSUER && env.OIDC_CLIENT_ID
      ? {
          issuer: env.OIDC_ISSUER,
          clientId: env.OIDC_CLIENT_ID,
          clientSecret: env.OIDC_CLIENT_SECRET || undefined,
          redirectUri: env.OIDC_REDIRECT_URI ?? 'http://localhost:3100/api/auth/oidc/callback',
        }
      : undefined,
    hrApi: env.HR_API_URL ? { url: env.HR_API_URL, token: env.HR_API_TOKEN } : undefined,
  };
}

export const CONFIG = Symbol('CONFIG');
