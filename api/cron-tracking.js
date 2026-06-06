// Varredura de rastreio + status: o Melhor Envio não devolve o código na hora
// da geração (vem depois), e o status muda conforme o envio anda (postado →
// entregue). Esta função busca no ME e:
//   - preenche o código de rastreio quando aparecer (+ e-mail pro cliente)
//   - avança o status do pedido: posted → Enviado, delivered → Entregue
//
// Roda pelo cron diário E pode ser disparada manualmente pelo painel.
// Auth: Bearer CRON_SECRET (cron) ou header x-admin-token (manual).

import { getTracking } from './_lib/melhor-envio.js';
import { listSyncableOrders, patchOrder, logEvent } from './_lib/db.js';
import { sendTrackingEmail, sendShippedEmail } from './_lib/mail.js';
import { withRequestLog } from './_lib/reqlog.js';

const RANK = { paid: 0, label_generated: 1, shipped: 2, delivered: 3 };

// Mapeia o status do ME pro nosso. Retorna null se não deve mudar.
function mapMeStatus(meStatus) {
  if (meStatus === 'delivered') return 'delivered';
  if (meStatus === 'posted' || meStatus === 'undelivered') return 'shipped';
  return null;
}

async function handler(req, res) {
  const okCron = process.env.CRON_SECRET && req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
  const okAdmin = req.headers['x-admin-token'] && req.headers['x-admin-token'] === process.env.STRIPE_WEBHOOK_SECRET;
  if (!okCron && !okAdmin) return res.status(401).json({ error: 'não autorizado' });

  let tracked = 0, emailed = 0, advanced = 0, stillPending = 0;
  try {
    const orders = await listSyncableOrders();
    for (const o of orders) {
      try {
        const t = await getTracking([o.me_order_id]);
        const info = t[o.me_order_id] ?? {};
        const code = info.tracking ?? null;
        const meStatus = info.status ?? null;

        const patch = {};
        let newCode = false;

        // 1) preenche o código se ainda não tinha
        if (code && !o.tracking_code) { patch.tracking_code = code; newCode = true; }

        // 2) avança o status conforme o ME (nunca volta atrás, nunca mexe em reembolsado)
        const mapped = mapMeStatus(meStatus);
        if (mapped && o.status !== 'refunded' && RANK[mapped] > (RANK[o.status] ?? 0)) {
          patch.status = mapped;
          if (mapped === 'shipped') patch.shipped_at = new Date().toISOString();
          if (mapped === 'delivered') patch.delivered_at = new Date().toISOString();
          advanced++;
        }

        if (Object.keys(patch).length) await patchOrder(o.stripe_session_id, patch);
        if (patch.tracking_code) tracked++;
        if (!code) stillPending++;

        // 3) e-mails por transição:
        //    - virou "postado" → e-mail "a caminho" (prioridade)
        //    - senão, código apareceu pela 1ª vez → e-mail "código disponível"
        const becameShipped = patch.status === 'shipped';
        const codeForEmail = code ?? o.tracking_code;
        if (becameShipped && codeForEmail) {
          const sent = await sendShippedEmail({ to: o.buyer_email, name: o.buyer_name, trackingCode: codeForEmail, summary: o.product_name });
          if (sent) {
            emailed++;
            await logEvent({ type: 'shipped_email', source: 'cron-tracking', stripe_session_id: o.stripe_session_id, status: 'ok', payload: { to: o.buyer_email, tracking: codeForEmail } });
          }
        } else if (newCode) {
          const sent = await sendTrackingEmail({ to: o.buyer_email, name: o.buyer_name, trackingCode: code, summary: o.product_name });
          if (sent) {
            emailed++;
            await logEvent({ type: 'tracking_email', source: 'cron-tracking', stripe_session_id: o.stripe_session_id, status: 'ok', payload: { to: o.buyer_email, tracking: code } });
          }
        }
      } catch (e) {
        console.error(`[cron-tracking] ${o.stripe_session_id}:`, e.message);
      }
    }
    console.log(`[cron-tracking] orders=${orders.length} tracked=${tracked} advanced=${advanced} emails=${emailed} ainda_sem=${stillPending}`);
    return res.status(200).json({ ok: true, checked: orders.length, tracked, advanced, emailed, still_pending: stillPending });
  } catch (err) {
    console.error('[cron-tracking] erro:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

export default withRequestLog('cron-tracking', handler);
