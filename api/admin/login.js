// Login do painel. POST { password } → seta cookie de sessão.
// GET → diz se a sessão atual é válida (pro front decidir tela de login).

import { checkPassword, createSessionCookie, clearSessionCookie, isAuthed } from './_auth.js';

export default function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ authed: isAuthed(req) });
  }
  if (req.method === 'DELETE') {
    res.setHeader('Set-Cookie', clearSessionCookie());
    return res.status(200).json({ ok: true });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'use POST' });

  if (!process.env.ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'ADMIN_PASSWORD não configurado no servidor' });
  }
  const { password } = req.body ?? {};
  if (!checkPassword(password)) {
    return res.status(401).json({ error: 'senha incorreta' });
  }
  res.setHeader('Set-Cookie', createSessionCookie());
  return res.status(200).json({ ok: true });
}
