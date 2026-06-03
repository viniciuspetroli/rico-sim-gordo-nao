// Auth do painel — senha compartilhada + cookie de sessão assinado (HMAC).
// Sem dependência externa: usa crypto nativo do Node.

import crypto from 'node:crypto';

const COOKIE_NAME = 'rsgn_admin';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias

// Chave de assinatura: reusa o STRIPE_WEBHOOK_SECRET (segredo server-only já existente).
function signingKey() {
  return process.env.ADMIN_SESSION_SECRET || process.env.STRIPE_WEBHOOK_SECRET || 'troque-isto';
}

function sign(payloadB64) {
  return crypto.createHmac('sha256', signingKey()).update(payloadB64).digest('base64url');
}

export function createSessionCookie() {
  const payload = { role: 'admin', exp: Date.now() + SESSION_TTL_MS };
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const token = `${b64}.${sign(b64)}`;
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function isAuthed(req) {
  const cookie = req.headers.cookie ?? '';
  const token = cookie.match(new RegExp(`${COOKIE_NAME}=([^;]+)`))?.[1];
  if (!token) return false;
  const [b64, sig] = token.split('.');
  if (!b64 || !sig) return false;
  const expected = sign(b64);
  // comparação em tempo constante
  if (sig.length !== expected.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  try {
    const payload = JSON.parse(Buffer.from(b64, 'base64url').toString());
    return payload.role === 'admin' && payload.exp > Date.now();
  } catch {
    return false;
  }
}

// Gate pra endpoints do painel. Retorna true se ok; senão já responde 401.
export function requireAuth(req, res) {
  if (isAuthed(req)) return true;
  res.status(401).json({ error: 'não autorizado' });
  return false;
}

export function checkPassword(input) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  const a = Buffer.from(String(input ?? ''));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
