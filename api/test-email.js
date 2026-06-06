// TEMPORÁRIO — dispara os e-mails de confirmação e rastreio pra um inbox de teste.
// Será removido logo após o teste. Destinatário fixo pra evitar abuso.

import { sendConfirmationEmail, sendTrackingEmail } from './_lib/mail.js';

const TEST_TO = 'viniciuspetroli@gmail.com';
const TEST_NAME = 'Vinicius Petroli Affonso';
const TEST_SUMMARY = '1× verde';
const TEST_TRACKING = 'AA123456785BR';

export default async function handler(req, res) {
  const confirmation = await sendConfirmationEmail({ to: TEST_TO, name: TEST_NAME, summary: TEST_SUMMARY });
  const tracking = await sendTrackingEmail({ to: TEST_TO, name: TEST_NAME, trackingCode: TEST_TRACKING, summary: TEST_SUMMARY });
  return res.status(200).json({ ok: true, to: TEST_TO, confirmation_sent: confirmation, tracking_sent: tracking });
}
