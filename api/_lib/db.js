// Cliente Supabase pras serverless functions. Usa a service_role key (bypassa RLS).
//
// REGRA: toda função aqui engole o próprio erro e loga. NUNCA lança.
// O banco é aditivo — se falhar, o fluxo de etiqueta (dinheiro/cliente real)
// segue normal. Persistência é secundária ao fulfillment.

import { createClient } from '@supabase/supabase-js';

let _client = null;
function db() {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('[db] SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configurados');
    return null;
  }
  _client = createClient(url, key, { auth: { persistSession: false } });
  return _client;
}

// Insere ou atualiza um pedido (idempotente por stripe_session_id).
export async function upsertOrder(record) {
  const c = db();
  if (!c) return null;
  try {
    const { data, error } = await c
      .from('orders')
      .upsert(record, { onConflict: 'stripe_session_id' })
      .select()
      .single();
    if (error) { console.error('[db] upsertOrder:', error.message); return null; }
    return data;
  } catch (err) {
    console.error('[db] upsertOrder exceção:', err.message);
    return null;
  }
}

// Atualiza campos de um pedido existente.
export async function updateOrder(stripeSessionId, patch) {
  const c = db();
  if (!c) return null;
  try {
    const { data, error } = await c
      .from('orders')
      .update(patch)
      .eq('stripe_session_id', stripeSessionId)
      .select()
      .single();
    if (error) { console.error('[db] updateOrder:', error.message); return null; }
    return data;
  } catch (err) {
    console.error('[db] updateOrder exceção:', err.message);
    return null;
  }
}

// Grava uma linha no log de eventos técnicos.
export async function logEvent(record) {
  const c = db();
  if (!c) return null;
  try {
    const { error } = await c.from('event_log').insert(record);
    if (error) console.error('[db] logEvent:', error.message);
  } catch (err) {
    console.error('[db] logEvent exceção:', err.message);
  }
}

// Salva inscrição na waitlist (idempotente por email+cor).
export async function saveWaitlist(record) {
  const c = db();
  if (!c) return null;
  try {
    const { error } = await c
      .from('waitlist')
      .upsert(record, { onConflict: 'email,color', ignoreDuplicates: true });
    if (error) console.error('[db] saveWaitlist:', error.message);
  } catch (err) {
    console.error('[db] saveWaitlist exceção:', err.message);
  }
}

// Lê o estado dos drops (disponibilidade por cor).
export async function getDrops() {
  const c = db();
  if (!c) return null;
  try {
    const { data, error } = await c.from('drops').select('*').order('sort');
    if (error) { console.error('[db] getDrops:', error.message); return null; }
    return data;
  } catch (err) {
    console.error('[db] getDrops exceção:', err.message);
    return null;
  }
}
