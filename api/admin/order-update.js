// Atualiza status de um pedido. POST { session_id, status, tracking_code? }
import { requireAuth } from './_auth.js';
import { setOrderStatus, logEvent } from '../_lib/db.js';

const ALLOWED = ['paid', 'label_generated', 'label_failed', 'shipped', 'delivered', 'refunded'];

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'use POST' });
  const { session_id, status, tracking_code } = req.body ?? {};
  if (!session_id || !status) return res.status(400).json({ error: 'session_id e status obrigatórios' });
  if (!ALLOWED.includes(status)) return res.status(400).json({ error: `status inválido (use: ${ALLOWED.join(', ')})` });
  try {
    const extra = {};
    if (tracking_code !== undefined) extra.tracking_code = tracking_code;
    const order = await setOrderStatus(session_id, status, extra);
    await logEvent({ type: 'status_change', source: 'admin-panel', stripe_session_id: session_id, status: 'ok', payload: { new_status: status } });
    return res.status(200).json({ ok: true, order });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
