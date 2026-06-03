// Lista pedidos pro painel. GET ?status=&q=
import { requireAuth } from './_auth.js';
import { listOrders, getStats } from '../_lib/db.js';

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  try {
    const { status, q, stats } = req.query ?? {};
    if (stats === '1') return res.status(200).json(await getStats());
    const orders = await listOrders({ status, q });
    return res.status(200).json({ orders });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
