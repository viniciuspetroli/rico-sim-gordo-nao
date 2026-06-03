// Lista a waitlist pro painel. GET
import { requireAuth } from './_auth.js';
import { listWaitlist } from '../_lib/db.js';

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  try {
    return res.status(200).json({ waitlist: await listWaitlist() });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
