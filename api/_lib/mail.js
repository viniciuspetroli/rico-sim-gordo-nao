// Envio de e-mail transacional via Resend. Engole erro — nunca derruba o webhook.

const RESEND_API = 'https://api.resend.com/emails';

function trackingTemplate({ name, trackingCode, summary }) {
  const firstName = (name || '').trim().split(' ')[0] || 'guerreiro';
  const trackUrl = `https://www.melhorrastreio.com.br/rastreio/${encodeURIComponent(trackingCode)}`;
  return `<!doctype html><html><body style="margin:0;background:#0e1209;font-family:Inter,Helvetica,Arial,sans-serif;">
  <div style="max-width:520px;margin:0 auto;padding:40px 24px;color:#e8dec3;">
    <div style="font-family:Georgia,serif;font-style:italic;font-size:20px;color:#c4a86b;margin-bottom:28px;">rico sim, gordo não</div>
    <div style="background:#1a1f12;border:1px solid #2a3320;border-radius:14px;padding:32px;">
      <h1 style="font-size:22px;margin:0 0 14px;color:#e8dec3;">Seu boné tá a caminho 🧢</h1>
      <p style="font-size:15px;line-height:1.6;color:#a8b890;margin:0 0 8px;">
        Fala, ${firstName}! Seu pedido (${summary || 'boné'}) foi postado e já tá rumo à sua porta.
      </p>
      <p style="font-size:13px;color:#7a8467;margin:24px 0 6px;text-transform:uppercase;letter-spacing:1px;">Código de rastreio</p>
      <div style="font-family:monospace;font-size:20px;font-weight:700;color:#c4a86b;background:#0e1209;border:1px solid #2a3320;border-radius:8px;padding:14px;text-align:center;letter-spacing:1px;">
        ${trackingCode}
      </div>
      <a href="${trackUrl}" style="display:block;margin-top:20px;background:#c4a86b;color:#1a1f12;text-decoration:none;font-weight:700;text-align:center;padding:15px;border-radius:8px;font-size:14px;">
        Rastrear meu pedido →
      </a>
      <p style="font-size:13px;line-height:1.6;color:#5a6147;margin:24px 0 0;">
        Pode levar alguns dias pro rastreio começar a atualizar. Quando o boné chegar, lembra: a primeira riqueza é o corpo. Todo dia.
      </p>
    </div>
    <p style="font-size:11px;color:#5a6147;text-align:center;margin-top:24px;">rico sim, gordo não · um movimento</p>
  </div>
  </body></html>`;
}

function confirmationTemplate({ name, summary }) {
  const firstName = (name || '').trim().split(' ')[0] || 'guerreiro';
  return `<!doctype html><html><body style="margin:0;background:#0e1209;font-family:Inter,Helvetica,Arial,sans-serif;">
  <div style="max-width:520px;margin:0 auto;padding:40px 24px;color:#e8dec3;">
    <div style="font-family:Georgia,serif;font-style:italic;font-size:20px;color:#c4a86b;margin-bottom:28px;">rico sim, gordo não</div>
    <div style="background:#1a1f12;border:1px solid #2a3320;border-radius:14px;padding:32px;">
      <h1 style="font-size:22px;margin:0 0 14px;color:#e8dec3;">Pedido confirmado 🧢</h1>
      <p style="font-size:15px;line-height:1.6;color:#a8b890;margin:0 0 14px;">
        Fala, ${firstName}! Recebemos seu pedido (${summary || 'boné'}) — bem-vindo ao movimento.
      </p>
      <p style="font-size:15px;line-height:1.6;color:#a8b890;margin:0 0 14px;">
        Já estamos preparando seu envio. Assim que o boné for postado, você recebe o <b style="color:#c4a86b;">código de rastreio</b> aqui mesmo, por e-mail.
      </p>
      <p style="font-size:13px;line-height:1.6;color:#5a6147;margin:24px 0 0;">
        A primeira riqueza é o corpo. Você acabou de colocar um lembrete disso na cabeça. Todo dia.
      </p>
    </div>
    <p style="font-size:11px;color:#5a6147;text-align:center;margin-top:24px;">rico sim, gordo não · um movimento</p>
  </div>
  </body></html>`;
}

export async function sendConfirmationEmail({ to, name, summary }) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  if (!key || !from) { console.error('[mail] RESEND_API_KEY ou MAIL_FROM não configurados'); return false; }
  if (!to) { console.warn('[mail] pedido sem e-mail do cliente — confirmação não enviada'); return false; }
  try {
    const res = await fetch(RESEND_API, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject: 'Pedido confirmado 🧢', html: confirmationTemplate({ name, summary }) }),
    });
    if (!res.ok) { console.error('[mail] Resend (confirmação) respondeu', res.status, await res.text()); return false; }
    console.log(`[mail] confirmação enviada pra ${to}`);
    return true;
  } catch (err) {
    console.error('[mail] falha enviando confirmação:', err.message);
    return false;
  }
}

export async function sendTrackingEmail({ to, name, trackingCode, summary }) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  if (!key || !from) { console.error('[mail] RESEND_API_KEY ou MAIL_FROM não configurados'); return false; }
  if (!to) { console.warn('[mail] pedido sem e-mail do cliente — não enviado'); return false; }
  if (!trackingCode) { console.warn('[mail] sem código de rastreio — e-mail não enviado'); return false; }

  try {
    const res = await fetch(RESEND_API, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to,
        subject: 'Seu boné tá a caminho 🧢',
        html: trackingTemplate({ name, trackingCode, summary }),
      }),
    });
    if (!res.ok) { console.error('[mail] Resend respondeu', res.status, await res.text()); return false; }
    console.log(`[mail] rastreio enviado pra ${to}`);
    return true;
  } catch (err) {
    console.error('[mail] falha enviando:', err.message);
    return false;
  }
}
