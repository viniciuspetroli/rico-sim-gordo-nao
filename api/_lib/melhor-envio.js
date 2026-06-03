// Cliente da API do Melhor Envio. Cuida de OAuth, refresh automático e fluxo cart→checkout→generate.

import { ME_BASE_URL, ME_USER_AGENT, ORIGIN_ADDRESS, PACKAGE_DIMENSIONS } from './config.js';
import { loadTokens, saveTokens } from './storage.js';

const REFRESH_THRESHOLD_MS = 24 * 60 * 60 * 1000; // refresha 1 dia antes de expirar

function buildHeaders(accessToken) {
  return {
    'Authorization': `Bearer ${accessToken}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': ME_USER_AGENT,
  };
}

export function buildAuthorizeUrl({ redirectUri, state }) {
  const params = new URLSearchParams({
    client_id: process.env.ME_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    state,
    scope: [
      'cart-read',
      'cart-write',
      'shipping-calculate',
      'shipping-checkout',
      'shipping-companies',
      'shipping-generate',
      'shipping-print',
      'shipping-share',
      'shipping-tracking',
      'shipping-cancel',
    ].join(' '),
  });
  return `${ME_BASE_URL}/oauth/authorize?${params.toString()}`;
}

export async function exchangeCodeForTokens({ code, redirectUri }) {
  const res = await fetch(`${ME_BASE_URL}/oauth/token`, {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'User-Agent': ME_USER_AGENT },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: process.env.ME_CLIENT_ID,
      client_secret: process.env.ME_CLIENT_SECRET,
      redirect_uri: redirectUri,
      code,
    }),
  });
  if (!res.ok) throw new Error(`ME OAuth exchange failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  await saveTokens(data);
  return data;
}

async function refreshTokens(refreshToken) {
  const res = await fetch(`${ME_BASE_URL}/oauth/token`, {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'User-Agent': ME_USER_AGENT },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: process.env.ME_CLIENT_ID,
      client_secret: process.env.ME_CLIENT_SECRET,
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) throw new Error(`ME refresh failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  await saveTokens(data);
  return data;
}

async function getValidAccessToken() {
  const tokens = await loadTokens();
  if (!tokens) throw new Error('Sem tokens do ME — autorize primeiro em /api/me-auth');
  if (tokens.expires_at - Date.now() < REFRESH_THRESHOLD_MS) {
    const refreshed = await refreshTokens(tokens.refresh_token);
    return refreshed.access_token;
  }
  return tokens.access_token;
}

// Renova o token incondicionalmente (usado pelo cron diário).
export async function refreshTokensNow() {
  const tokens = await loadTokens();
  if (!tokens?.refresh_token) throw new Error('Sem refresh_token salvo — autorize em /api/me-auth');
  const refreshed = await refreshTokens(tokens.refresh_token);
  return { expires_in: refreshed.expires_in, expires_at: Date.now() + refreshed.expires_in * 1000 };
}

async function meRequest(path, { method = 'GET', body } = {}) {
  const token = await getValidAccessToken();
  const res = await fetch(`${ME_BASE_URL}/api/v2${path}`, {
    method,
    headers: buildHeaders(token),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error(`ME API ${method} ${path} ${res.status}`);
    err.response = data;
    throw err;
  }
  return data;
}

// Calcula fretes disponíveis e retorna o mais barato. Aceita pacote customizado
// (peso escalado pela quantidade).
export async function pickCheapestService({ destination, insuranceValue, pkg }) {
  const body = {
    from: { postal_code: ORIGIN_ADDRESS.postal_code },
    to: { postal_code: destination.postal_code },
    package: pkg ?? PACKAGE_DIMENSIONS,
    options: {
      insurance_value: insuranceValue,
      receipt: false,
      own_hand: false,
    },
  };
  const services = await meRequest('/me/shipment/calculate', { method: 'POST', body });
  const valid = services.filter(s => !s.error && s.price);
  if (!valid.length) throw new Error(`Nenhum serviço disponível pro CEP ${destination.postal_code}: ${JSON.stringify(services)}`);
  valid.sort((a, b) => parseFloat(a.price) - parseFloat(b.price));
  return valid[0];
}

// Adiciona um envio ao carrinho do ME. Aceita vários produtos (uma linha por cor),
// valor de seguro total e pacote (peso escalado). Retorna o id do shipment.
export async function addToCart({ service, destination, recipient, products, insuranceValue, pkg }) {
  const payload = {
    service: service.id,
    from: ORIGIN_ADDRESS,
    to: { ...destination, ...recipient },
    products,
    volumes: [pkg ?? PACKAGE_DIMENSIONS],
    options: {
      insurance_value: insuranceValue,
      receipt: false,
      own_hand: false,
      reverse: false,
      non_commercial: true,
    },
  };
  return await meRequest('/me/cart', { method: 'POST', body: payload });
}

// Paga o frete usando saldo do ME e gera as etiquetas.
export async function checkoutAndGenerate(orderIds) {
  await meRequest('/me/shipment/checkout', { method: 'POST', body: { orders: orderIds } });
  return await meRequest('/me/shipment/generate', { method: 'POST', body: { orders: orderIds } });
}

// Pega URL pra imprimir as etiquetas (PDF).
export async function getPrintUrl(orderIds) {
  return await meRequest('/me/shipment/print', { method: 'POST', body: { mode: 'private', orders: orderIds } });
}

export async function getTracking(orderIds) {
  return await meRequest('/me/shipment/tracking', { method: 'POST', body: { orders: orderIds } });
}
