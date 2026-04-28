// Recebe o redirect do ME após autorização. Troca o `code` por tokens e salva no storage.

import { exchangeCodeForTokens } from './_lib/melhor-envio.js';

export default async function handler(req, res) {
  const { code, state } = req.query;
  if (!code) return res.status(400).send('Faltou o parâmetro code');

  const cookieHeader = req.headers.cookie ?? '';
  const stateCookie = cookieHeader.match(/me_oauth_state=([^;]+)/)?.[1];
  if (!stateCookie || stateCookie !== state) {
    return res.status(400).send('State inválido — possível tentativa de CSRF');
  }

  const host = req.headers['x-forwarded-host'] ?? req.headers.host;
  const redirectUri = `https://${host}/api/me-callback`;

  try {
    const tokens = await exchangeCodeForTokens({ code, redirectUri });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!doctype html><html><head><title>Autorização concluída</title><style>body{font-family:system-ui;background:#1a1f12;color:#e8dec3;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;text-align:center}div{max-width:480px}h1{color:#c4a86b;font-weight:400}code{background:#0e1209;padding:4px 8px;border-radius:4px;font-size:14px}</style></head><body><div><h1>✓ Tokens salvos</h1><p>Melhor Envio autorizado. Token expira em ${Math.floor(tokens.expires_in / 86400)} dias — refresh automático cuida do resto.</p><p>Pode fechar essa aba.</p></div></body></html>`);
  } catch (err) {
    console.error(err);
    res.status(500).send(`Falha trocando code por token: ${err.message}`);
  }
}
