// Inicia o fluxo OAuth do Melhor Envio.
// Você abre /api/me-auth no navegador, ele redireciona pro ME, você autoriza,
// e o ME redireciona pro /api/me-callback que troca o code por tokens.

import crypto from 'node:crypto';
import { buildAuthorizeUrl } from './_lib/melhor-envio.js';
import { ME_ENV, ME_BASE_URL } from './_lib/config.js';
import { withRequestLog } from './_lib/reqlog.js';

function handler(req, res) {
  console.log(`[me-auth] ME_ENV raw=${JSON.stringify(process.env.ME_ENV)} resolved=${ME_ENV} base=${ME_BASE_URL} client_id=${process.env.ME_CLIENT_ID}`);
  if (!process.env.ME_CLIENT_ID || !process.env.ME_CLIENT_SECRET) {
    return res.status(500).json({ error: 'ME_CLIENT_ID e ME_CLIENT_SECRET precisam estar configurados em env vars do Vercel' });
  }
  const host = req.headers['x-forwarded-host'] ?? req.headers.host;
  const redirectUri = `https://${host}/api/me-callback`;

  const state = crypto.randomBytes(16).toString('hex');
  res.setHeader('Set-Cookie', `me_oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);

  const url = buildAuthorizeUrl({ redirectUri, state });
  res.writeHead(302, { Location: url });
  res.end();
}

export default withRequestLog('me-auth', handler);
