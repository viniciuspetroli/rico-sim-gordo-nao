// withRequestLog — envolve um handler e registra cada requisição
// (método, URL, headers, body, e a resposta que demos) na tabela request_log.
//
// O log NUNCA quebra a resposta: erros de gravação são engolidos, e a
// resposta ao cliente já foi enviada antes do insert terminar.

import { logRequest } from './db.js';

// Não guardamos valores de segredos nossos no banco.
const REDACT = new Set(['authorization', 'cookie', 'x-admin-token', 'stripe-signature']);

function safeHeaders(h) {
  const out = {};
  for (const k in (h || {})) out[k] = REDACT.has(k.toLowerCase()) ? '[redacted]' : h[k];
  return out;
}

function toText(v) {
  if (v == null) return null;
  let s;
  if (typeof v === 'string') s = v;
  else if (Buffer.isBuffer(v)) s = v.toString('utf8');
  else { try { s = JSON.stringify(v); } catch { s = String(v); } }
  return s.length > 10000 ? s.slice(0, 10000) + '…[truncado]' : s;
}

export function withRequestLog(source, handler) {
  return async function (req, res) {
    let responseBody;
    const oJson = res.json?.bind(res);
    const oSend = res.send?.bind(res);
    const oEnd = res.end?.bind(res);
    if (oJson) res.json = b => { responseBody = b; return oJson(b); };
    if (oSend) res.send = b => { if (responseBody === undefined) responseBody = b; return oSend(b); };
    if (oEnd) res.end = (c, ...a) => { if (c && responseBody === undefined) responseBody = c; return oEnd(c, ...a); };

    try {
      return await handler(req, res);
    } finally {
      // body: handlers de body cru (ex.: stripe-webhook) setam req._logBody
      const body = req._logBody !== undefined ? req._logBody : req.body;
      await logRequest({
        source,
        method: req.method,
        path: (req.url || '').split('?')[0],
        query: (req.query && Object.keys(req.query).length) ? req.query : null,
        headers: safeHeaders(req.headers),
        body: toText(body),
        ip: (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || null,
        status: res.statusCode,
        response: toText(responseBody),
      });
    }
  };
}
