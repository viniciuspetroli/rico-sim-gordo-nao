// Drops pro painel. GET lista; POST { color, available } liga/desliga venda.
import { requireAuth } from './_auth.js';
import { getDrops, setDropAvailable, logEvent } from '../_lib/db.js';

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  if (req.method === 'GET') {
    const drops = await getDrops();
    return res.status(200).json({ drops: drops ?? [] });
  }
  if (req.method === 'POST') {
    const { color, available } = req.body ?? {};
    if (!color || typeof available !== 'boolean') return res.status(400).json({ error: 'color e available (boolean) obrigatórios' });
    try {
      const drop = await setDropAvailable(color, available);
      await logEvent({ type: 'drop_toggle', source: 'admin-panel', status: 'ok', payload: { color, available } });
      return res.status(200).json({ ok: true, drop });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }
  return res.status(405).json({ error: 'método não suportado' });
}
