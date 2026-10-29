// Ejecuta el código del snapshot contra RPC locales; Meta/IA quedan sin transporte.
// Las credenciales efímeras entran por stdin, nunca argumentos, logs ni evidencia.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { localUrl } from './release-tools.mjs';

// Códigos internos de diagnóstico: nunca imprimen respuestas, mensajes o claves.
let failureCode = 20;

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const { api: rawApi, key, userId, multiple = false } = JSON.parse(input);
  const api = localUrl(rawApi);
  assert.match(userId, /^[a-f0-9-]{36}$/);
  const directory = resolve(process.argv[2]);
  const transport = globalThis.fetch;
  // También intercepta cualquier llamada accidental de prepareMessage a proveedores.
  globalThis.fetch = (url, options) => {
    const parsed = new URL(typeof url === 'string' || url instanceof URL ? url : url.url);
    assert.equal(parsed.origin, api, 'El probe no admite tráfico externo.');
    return transport(url, options);
  };
  const { createClient } = createRequire(join(directory, 'package.json'))('@supabase/supabase-js');
  const client = createClient(api, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { runActor } = await import(pathToFileURL(join(directory, 'supabase/functions/whatsapp-webhook/queue.ts')));
  const { prepareMessage } = await import(pathToFileURL(join(directory, 'supabase/functions/whatsapp-webhook/processor.ts')));
  const { formatDraftList } = await import(pathToFileURL(join(directory, 'supabase/functions/whatsapp-webhook/helpers.ts')));
  const waId = 'synthetic-runtime-' + randomUUID();
  const prefix = 'release-runtime-' + randomUUID();
  const messageIds = [], groupIds = [], transactionIds = [], stages = [];
  let prepareCount = 0, failSend = false, deliveries = 0;
  const checked = async operation => {
    const { data, error } = await operation;
    assert.ok(!error, 'Fallo de base local en probe de runtime.');
    return data;
  };
  const rpc = (name, args) => checked(client.rpc(name, args));
  const deps = {
    rpc,
    prepare: async (job, checkpoint, signal) => { prepareCount++; return prepareMessage(client, job, checkpoint, signal); },
    send: async () => {
      if (failSend) { failSend = false; throw new Error('SYNTHETIC_SEND_FAILURE'); }
      deliveries++;
    },
    format: snapshot => formatDraftList(snapshot.items ?? []),
    now: Date.now, sleep: ms => new Promise(done => setTimeout(done, ms)), token: randomUUID,
    metric: (event, data) => { if (event === 'queue_retry') stages.push(data.stage); },
  };
  const enqueue = async (text, checkpoint) => {
    const id = prefix + '-' + messageIds.length;
    messageIds.push(id);
    await rpc('enqueue_whatsapp_messages', { p_messages: [{ id, from: waId, type: 'text', timestamp: String(Math.floor(Date.now() / 1000) + 1), text: { body: text } }] });
    if (checkpoint) await checked(client.from('whatsapp_message_queue').update({ parsed_result: checkpoint }).eq('wa_message_id', id));
    return id;
  };
  const active = async () => {
    const group = await rpc('get_active_draft_group', { p_user_id: userId });
    assert.ok(group?.group_id && group.items?.length, 'Falta el borrador esperado.');
    if (!groupIds.includes(group.group_id)) groupIds.push(group.group_id);
    return group;
  };
  const transactions = async () => checked(client.from('transactions').select('id,amount_ars,wa_message_id').eq('user_id', userId));
  const originalTransactions = await transactions();
  const originalLink = await checked(client.from('whatsapp_links').select('wa_id,status,linked_at').eq('user_id', userId).single());
  try {
    failureCode = 21;
    await checked(client.from('whatsapp_queue_control').update({ enabled: true }).eq('singleton', true));
    await checked(client.from('whatsapp_links').update({ wa_id: waId, status: 'active' }).eq('user_id', userId));
    await enqueue('Gasté 123 en prueba contrato');
    await runActor(waId, deps);
    assert.equal(Number((await active()).items[0].amount), 123);
    failureCode = 22;
    await enqueue('El 1 fue de 250');
    await runActor(waId, deps);
    assert.equal(Number((await active()).items[0].amount), 250);

    failureCode = 23;
    failSend = true;
    const confirmationId = await enqueue('CONFIRMAR');
    await runActor(waId, deps);
    const first = await checked(client.from('whatsapp_message_queue').select('effect_applied,status,error_message').eq('wa_message_id', confirmationId).single());
    assert.deepEqual(first, { effect_applied: true, status: 'failed', error_message: 'QUEUE_SEND_RETRY' });
    const inbound = await checked(client.from('inbound_events').select('error_code').eq('wa_message_id', confirmationId).single());
    assert.equal(inbound.error_code, 'QUEUE_SEND_RETRY');
    assert.equal(stages.at(-1), 'send');
    const saved = (await transactions()).filter(row => row.wa_message_id?.startsWith(prefix));
    transactionIds.push(...saved.map(row => row.id));
    assert.equal(saved.length, 1);
    assert.equal(Number(saved[0].amount_ars), 250);
    failureCode = 24;
    const beforeRetry = prepareCount, beforeDelivery = deliveries;
    await checked(client.from('whatsapp_message_queue').update({ scheduled_for: '2000-01-01T00:00:00Z' }).eq('wa_message_id', confirmationId));
    await runActor(waId, deps);
    assert.equal(prepareCount, beforeRetry, 'El reintento no debe reinterpretar el movimiento.');
    assert.equal(deliveries, beforeDelivery + 1);
    assert.equal((await transactions()).filter(row => row.wa_message_id?.startsWith(prefix)).length, 1);
    const delivered = await checked(client.from('whatsapp_message_queue').select('status,reply_sent_at').eq('wa_message_id', confirmationId).single());
    assert.equal(delivered.status, 'processed');
    assert.ok(delivered.reply_sent_at);
    failureCode = 25;
    // Reenvío de Meta: mismo identificador, sin una segunda operación financiera.
    await rpc('enqueue_whatsapp_messages', { p_messages: [{ id: confirmationId, from: waId, type: 'text', text: { body: 'CONFIRMAR' } }] });
    await runActor(waId, deps);
    assert.equal(prepareCount, beforeRetry);
    assert.equal((await transactions()).filter(row => row.wa_message_id?.startsWith(prefix)).length, 1);

    failureCode = 26;
    await enqueue('Gasté 456 en contrato descartar');
    await runActor(waId, deps);
    const discarded = await active();
    await enqueue('CANCELAR');
    await runActor(waId, deps);
    assert.equal((await checked(client.from('draft_groups').select('status').eq('id', discarded.group_id).single())).status, 'discarded');

    if (multiple) {
      failureCode = 27;
      await enqueue('Gasté 101 en contrato uno');
      await enqueue('Gasté 202 en contrato dos');
      await enqueue('Gasté 303 en contrato tres');
      await runActor(waId, deps);
      const group = await active();
      assert.equal(group.items.length, 3);
      failureCode = 28;
      const edits = [{ position: 1, patch: { amount: 111 } }, { position: 2, patch: { amount: 222 } }];
      // Checkpoint sintético de interpretación; processor/queue/RPC reales lo consumen.
      await enqueue('correcciones del ensayo', { intent: 'edit_pending', movements: [], pendingEdit: {
        kind: 'edit', position: 1, patch: edits[0].patch, edits, group_id: group.group_id, version: group.version,
      } });
      await runActor(waId, deps);
      assert.deepEqual((await active()).items.map(item => Number(item.amount)), [111, 222, 303]);
      failureCode = 29;
      await enqueue('Quitá el 1 y el 2');
      await runActor(waId, deps);
      const remaining = (await active()).items.filter(item => item.status === 'pending');
      assert.equal(remaining.length, 1);
      assert.equal(remaining[0].position, 3);
      await enqueue('CANCELAR');
      await runActor(waId, deps);
    }
    failureCode = 30;
    assert.equal((await transactions()).length, originalTransactions.length + 1);
  } finally {
    // Solo fixtures identificados de este probe, sobre una URL loopback validada.
    if (transactionIds.length) await checked(client.from('transactions').delete().in('id', transactionIds));
    if (groupIds.length) await checked(client.from('draft_groups').delete().in('id', groupIds));
    await checked(client.from('whatsapp_message_queue').delete().eq('wa_id', waId));
    await checked(client.from('inbound_events').delete().in('wa_message_id', messageIds));
    await checked(client.from('whatsapp_worker_state').delete().eq('wa_id', waId));
    await checked(client.from('whatsapp_links').update(originalLink).eq('user_id', userId));
    await checked(client.from('whatsapp_queue_control').update({ enabled: false }).eq('singleton', true));
  }
  failureCode = 31;
  assert.deepEqual(await transactions(), originalTransactions);
  console.log(JSON.stringify({ passed: true, realRuntimeAndRpc: true, retryWithoutReinterpretation: true, idempotentConfirmation: true, multiple }));
}

try { await main(); }
catch { console.error('Fallo del probe local de runtime; se omiten credenciales y respuestas.'); process.exitCode = failureCode; }
