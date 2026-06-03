// Cron diário: renova o token do Melhor Envio antes de expirar.
// Token dura 30 dias; renovando todo dia ele nunca morre por inatividade.
//
// Disparado pelo Vercel Cron (ver vercel.json). Protegido por CRON_SECRET:
// se a env var existir, exige Authorization: Bearer <CRON_SECRET>.

import { refreshTokensNow } from './_lib/melhor-envio.js';
import { logEvent } from './_lib/db.js';
import { notifyTokenError } from './_lib/notify.js';
import { withRequestLog } from './_lib/reqlog.js';

async function handler(req, res) {
  // Vercel injeta Authorization: Bearer <CRON_SECRET> quando a env var existe.
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'não autorizado' });
  }

  try {
    const result = await refreshTokensNow();
    const days = Math.floor((result.expires_in ?? 0) / 86400);
    console.log(`[cron] token ME renovado, expira em ~${days} dias`);
    await logEvent({ type: 'me_token_refreshed', source: 'cron-refresh-me', status: 'ok', payload: { expires_in_days: days } });
    return res.status(200).json({ ok: true, expires_in_days: days });
  } catch (err) {
    console.error('[cron] falha renovando token ME:', err.message);
    await logEvent({ type: 'me_token_error', source: 'cron-refresh-me', status: 'error', error: err.message });
    await notifyTokenError({ error: { message: err.message }, action: 'Reautorize em /api/me-auth (conta de produção do ME).' });
    return res.status(500).json({ error: err.message });
  }
}

export default withRequestLog('cron-refresh-me', handler);
