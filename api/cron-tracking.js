// Varredura de rastreio: o Melhor Envio não devolve o código na hora da
// geração — ele aparece minutos/horas depois. Esta função pega os pedidos
// com etiqueta mas sem rastreio, busca no ME, atualiza e avisa o cliente.
//
// Roda pelo cron diário E pode ser disparada manualmente pelo painel.
// Auth: Bearer CRON_SECRET (cron) ou header x-admin-token (manual).

import { getTracking } from './_lib/melhor-envio.js';
import { listPendingTracking, patchOrder, logEvent } from './_lib/db.js';
import { sendTrackingEmail } from './_lib/mail.js';
import { withRequestLog } from './_lib/reqlog.js';

async function handler(req, res) {
  const okCron = process.env.CRON_SECRET && req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
  const okAdmin = req.headers['x-admin-token'] && req.headers['x-admin-token'] === process.env.STRIPE_WEBHOOK_SECRET;
  if (!okCron && !okAdmin) return res.status(401).json({ error: 'não autorizado' });

  let updated = 0, emailed = 0, stillPending = 0;
  try {
    const pending = await listPendingTracking();
    for (const o of pending) {
      try {
        const t = await getTracking([o.me_order_id]);
        const code = t[o.me_order_id]?.tracking;
        if (!code) { stillPending++; continue; }
        await patchOrder(o.stripe_session_id, { tracking_code: code });
        updated++;
        const sent = await sendTrackingEmail({ to: o.buyer_email, name: o.buyer_name, trackingCode: code, summary: o.product_name });
        if (sent) {
          emailed++;
          await logEvent({ type: 'tracking_email', source: 'cron-tracking', stripe_session_id: o.stripe_session_id, status: 'ok', payload: { to: o.buyer_email, tracking: code } });
        }
      } catch (e) {
        console.error(`[cron-tracking] ${o.stripe_session_id}:`, e.message);
      }
    }
    console.log(`[cron-tracking] pendentes=${pending.length} atualizados=${updated} emails=${emailed} ainda_sem=${stillPending}`);
    return res.status(200).json({ ok: true, pending: pending.length, updated, emailed, still_pending: stillPending });
  } catch (err) {
    console.error('[cron-tracking] erro:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

export default withRequestLog('cron-tracking', handler);
