import type { AuthCapabilitiesDto } from '../schemas/index.js';
import type { Env } from '../config/env.js';

export function buildAuthCapabilities(env: Pick<Env, 'googleOAuth'>): AuthCapabilitiesDto {
  return {
    emailPassword: true,
    registration: true,
    socialProviders: { google: env.googleOAuth !== null },
  };
}
