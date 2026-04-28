// Wrapper sobre Upstash Redis pra guardar tokens do Melhor Envio.
// Tokens precisam de storage persistente porque o refresh_token rotaciona a cada uso.

import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

const TOKEN_KEY = 'me:tokens';

export async function saveTokens({ access_token, refresh_token, expires_in }) {
  const expiresAt = Date.now() + expires_in * 1000;
  await redis.set(TOKEN_KEY, { access_token, refresh_token, expires_at: expiresAt });
}

export async function loadTokens() {
  return await redis.get(TOKEN_KEY);
}

export async function clearTokens() {
  await redis.del(TOKEN_KEY);
}
