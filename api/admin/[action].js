// Despachante único do painel — colapsa todas as rotas /api/admin/* numa
// só função (rota dinâmica do Vercel) pra caber no limite do plano Hobby.
//
// /api/admin/login | orders | order-update | regenerate | drops | waitlist | events
// O segmento vira req.query.action.

import { checkPassword, createSessionCookie, clearSessionCookie, isAuthed, requireAuth } from './_auth.js';
import {
  listOrders, getStats, setOrderStatus, patchOrder, listWaitlist, listEvents,
  getDrops, setDropAvailable, setDropStock, logEvent,
} from '../_lib/db.js';

const STATUS_ALLOWED = ['paid', 'label_generated', 'label_failed', 'shipped', 'delivered', 'refunded'];

export default async function handler(req, res) {
  const action = req.query.action;

  try {
    // ── login (única rota sem auth prévia) ──
    if (action === 'login') {
      if (req.method === 'GET') return res.status(200).json({ authed: isAuthed(req) });
      if (req.method === 'DELETE') { res.setHeader('Set-Cookie', clearSessionCookie()); return res.status(200).json({ ok: true }); }
      if (req.method !== 'POST') return res.status(405).json({ error: 'use POST' });
      if (!process.env.ADMIN_PASSWORD) return res.status(500).json({ error: 'ADMIN_PASSWORD não configurado no servidor' });
      if (!checkPassword(req.body?.password)) return res.status(401).json({ error: 'senha incorreta' });
      res.setHeader('Set-Cookie', createSessionCookie());
      return res.status(200).json({ ok: true });
    }

    // ── daqui pra baixo, tudo exige sessão ──
    if (!requireAuth(req, res)) return;

    switch (action) {
      case 'orders': {
        if (req.query.stats === '1') return res.status(200).json(await getStats());
        const orders = await listOrders({ status: req.query.status, q: req.query.q });
        return res.status(200).json({ orders });
      }

      case 'order-update': {
        if (req.method !== 'POST') return res.status(405).json({ error: 'use POST' });
        const { session_id, status, tracking_code } = req.body ?? {};
        if (!session_id) return res.status(400).json({ error: 'session_id obrigatório' });
        if (!status && tracking_code === undefined) return res.status(400).json({ error: 'informe status ou tracking_code' });
        let order;
        if (status) {
          if (!STATUS_ALLOWED.includes(status)) return res.status(400).json({ error: `status inválido (use: ${STATUS_ALLOWED.join(', ')})` });
          const extra = {};
          if (tracking_code !== undefined) extra.tracking_code = tracking_code;
          order = await setOrderStatus(session_id, status, extra);
          await logEvent({ type: 'status_change', source: 'admin-panel', stripe_session_id: session_id, status: 'ok', payload: { new_status: status, tracking_code } });
        } else {
          order = await patchOrder(session_id, { tracking_code });
          await logEvent({ type: 'tracking_update', source: 'admin-panel', stripe_session_id: session_id, status: 'ok', payload: { tracking_code } });
        }
        return res.status(200).json({ ok: true, order });
      }

      case 'regenerate': {
        if (req.method !== 'POST') return res.status(405).json({ error: 'use POST' });
        const { session_id, cep_override } = req.body ?? {};
        if (!session_id) return res.status(400).json({ error: 'session_id obrigatório' });
        const host = req.headers['x-forwarded-host'] ?? req.headers.host;
        const proto = req.headers['x-forwarded-proto'] ?? 'https';
        const r = await fetch(`${proto}://${host}/api/admin-generate-etiqueta`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-admin-token': process.env.STRIPE_WEBHOOK_SECRET },
          body: JSON.stringify({ session_id, ...(cep_override ? { cep_override } : {}) }),
        });
        const data = await r.json();
        return res.status(r.status).json(data);
      }

      case 'drops': {
        if (req.method === 'GET') return res.status(200).json({ drops: (await getDrops()) ?? [] });
        if (req.method === 'POST') {
          const { color, available, stock } = req.body ?? {};
          if (!color) return res.status(400).json({ error: 'color obrigatório' });
          let drop;
          if (stock !== undefined) {
            drop = await setDropStock(color, stock);
            await logEvent({ type: 'drop_stock', source: 'admin-panel', status: 'ok', payload: { color, stock } });
          }
          if (typeof available === 'boolean') {
            drop = await setDropAvailable(color, available);
            await logEvent({ type: 'drop_toggle', source: 'admin-panel', status: 'ok', payload: { color, available } });
          }
          if (!drop) return res.status(400).json({ error: 'informe available (boolean) ou stock' });
          return res.status(200).json({ ok: true, drop });
        }
        return res.status(405).json({ error: 'método não suportado' });
      }

      case 'waitlist':
        return res.status(200).json({ waitlist: await listWaitlist() });

      case 'events':
        return res.status(200).json({ events: await listEvents() });

      default:
        return res.status(404).json({ error: `rota desconhecida: ${action}` });
    }
  } catch (err) {
    console.error(`[admin/${action}]`, err.message);
    return res.status(500).json({ error: err.message });
  }
}
