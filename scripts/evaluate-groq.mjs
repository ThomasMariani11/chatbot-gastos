// Experimento sintético de Groq: nunca modifica datos ni configura producción.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import ts from 'typescript';
const root = new URL('../', import.meta.url), today = '2026-10-20';
await mkdir(new URL('.temp/groq-review/', root), { recursive: true });
const source = await readFile(new URL('supabase/functions/whatsapp-webhook/helpers.ts', root), 'utf8');
const sf = ts.createSourceFile('helpers.ts', source, ts.ScriptTarget.Latest, true);
let se, pe;
function walk(n) { if (ts.isVariableDeclaration(n)) {
    if (n.name.getText(sf) === 'multiResponseJsonSchema')
        se = n.initializer.getText(sf);
    if (n.name.getText(sf) === 'prompt' && n.initializer && ts.isTemplateExpression(n.initializer))
        pe = n.initializer.getText(sf);
} ts.forEachChild(n, walk); }
walk(sf);
const schema = Function('return (' + se + ')')(), makePrompt = Function('input', 'today', 'return (' + pe + ')');
function strictSchema(node) { const s = structuredClone(node); if (s.properties) {
    const required = new Set(s.required || []);
    for (const [k, v] of Object.entries(s.properties)) {
        s.properties[k] = strictSchema(v);
        if (!required.has(k)) {
            const types = Array.isArray(s.properties[k].type) ? s.properties[k].type : [s.properties[k].type];
            s.properties[k].type = [...new Set([...types, 'null'])];
        }
    }
    s.required = Object.keys(s.properties);
    s.additionalProperties = false;
} if (s.items)
    s.items = strictSchema(s.items); return s; }
const strict = strictSchema(schema);
function errors(v, s, path = '') { const list = [], types = Array.isArray(s.type) ? s.type : [s.type], actual = v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v; if (!types.some(t => t === actual || (t === 'integer' && actual === 'number' && Number.isInteger(v))))
    return [path + ':type']; if (s.enum && !s.enum.includes(v))
    list.push(path + ':enum'); if (actual === 'number' && (!Number.isFinite(v) || (s.minimum !== undefined && v < s.minimum) || (s.maximum !== undefined && v > s.maximum)))
    list.push(path + ':range'); if (actual === 'object') {
    for (const k of s.required || [])
        if (!Object.hasOwn(v, k))
            list.push(path + '/' + k + ':missing');
    for (const [k, x] of Object.entries(v)) {
        if (s.properties?.[k])
            list.push(...errors(x, s.properties[k], path + '/' + k));
        else if (s.additionalProperties === false)
            list.push(path + '/' + k + ':extra');
    }
} if (actual === 'array' && s.items)
    v.forEach((x, i) => list.push(...errors(x, s.items, path + '/' + i))); return list; }
function normalize(parsed) { const p = structuredClone(parsed); if (p.edit === null && p.intent !== 'edit_item')
    delete p.edit; for (const m of p.movements || []) {
    if (m.occurredOn === null)
        m.occurredOn = today;
    if (m.category === null)
        m.category = 'Otros';
} return p; }
const addedRules = `\nREGLAS DE COMPATIBILIDAD DE PESITO:\n- totalAmountArs es un NOMBRE HISTORICO. Siempre contiene el importe numérico en la moneda indicada por currency. Si cobró 100 dólares: totalAmountArs=100 y currency=USD. No conviertas monedas ni dejes ese importe en null.\n- Es el TOTAL de la compra. Si el total es 12000 en 3 cuotas: totalAmountArs=12000 e installments=3. No lo dividas por tres.\n- Si no dice fecha, occurredOn=${today} y no incluyas date en missingFields. Solo preguntá fecha si el usuario indicó una fecha ambigua.\n- Si no se identifica categoría, usá Otros y no incluyas category en missingFields.\n- Sin cuotas: installments=1. Con cuotas y sin mes explícito: firstInstallmentMonth=${today.slice(0, 7)}.\n- Datos esenciales faltantes se conservan: monto desconocido => totalAmountArs=null y missingFields incluye amount. Nunca inventes importes.\n- Un ticket es un movimiento por el total; no conviertas sus productos en movimientos separados.\n`;
const mixed = { id: 'mixed_text', text: 'Gasté 1500 en supermercado y 500 en nafta, y cobré 80000 por trabajo de diseño.', expected: [['expense', 1500, 'ARS', 1], ['expense', 500, 'ARS', 1], ['income', 80000, 'ARS', 1]] };
const photo = { id: 'receipt_single_total', text: '', image: true, expected: [['expense', 1500, 'ARS', 1]] };
const currency = { id: 'currencies_and_installments', text: 'Cobré 100 dólares por diseño y pagué una silla por un total de 12000 pesos en 3 cuotas.', expected: [['income', 100, 'USD', 1], ['expense', 12000, 'ARS', 3]] };
const cases = [{ ...photo, mode: 'original' }, { ...currency, mode: 'original' }, ...[photo, currency, mixed, { id: 'audio', audio: true, expected: [['expense', 1500, 'ARS', 1]] }, { id: 'correction', text: 'El 2 fue de 5000.', draft: '1. Gasto Supermercado ARS 1500.\n2. Gasto Nafta ARS 500.\n3. Ingreso Diseño ARS 80000.', edit: { position: 2, amount: 5000 } }, { id: 'missing_amount', text: 'Gasté en farmacia.', missing: true }].map(x => ({ ...x, mode: 'strict_candidate' }))];
const fixtures = { audio: await readFile(new URL('tests/fixtures/groq-evaluation/expense.wav', root)), image: await readFile(new URL('tests/fixtures/groq-evaluation/receipt.png', root)) };
if (process.argv.includes('--dry-run')) {
    if (errors({ intent: 'unknown', movements: [] }, schema).length)
        throw Error('VALIDATOR_SETUP');
    if (!errors({ intent: 'add_movements', movements: [{ kind: 'expense' }] }, schema).length)
        throw Error('VALIDATOR_INCOMPLETE');
    const fixture = {intent:'add_movements',movements:[{currency:'USD',totalAmountArs:100,occurredOn:null,category:null}]};
    const normalized = normalize(fixture);
    if (normalized.movements[0].totalAmountArs !== 100 || normalized.movements[0].currency !== 'USD' || normalized.movements[0].occurredOn !== today || normalized.movements[0].category !== 'Otros') throw Error('DEFAULT_OR_CURRENCY_REGRESSION');
    if (fixture.movements[0].occurredOn !== null) throw Error('NORMALIZER_MUTATED_INPUT');
    if (normalize({intent:'add_movements',movements:[],edit:null}).edit !== undefined) throw Error('UNUSED_EDIT_NULL_NOT_REMOVED');
    if (!errors(normalize({intent:'edit_item',movements:[],edit:null}),schema).length) throw Error('EMPTY_EDIT_WAS_ACCEPTED');
    if (!errors({intent:'add_movements',movements:[{...normalized.movements[0],totalAmountArs:'100'}]},schema).length) throw Error('STRING_AMOUNT_WAS_ACCEPTED');
    const missing = normalize({intent:'add_movements',movements:[{totalAmountArs:null,missingFields:['amount'],occurredOn:null,category:null}]});
    if (missing.movements[0].totalAmountArs !== null || !missing.movements[0].missingFields.includes('amount')) throw Error('MISSING_AMOUNT_WAS_INVENTED');
    await writeFile(new URL('.temp/groq-review/strict-schema.json', root), JSON.stringify(strict, null, 2));
    console.log(JSON.stringify({ prepared: true, cases: cases.length, liveCalls: 0 }));
    process.exit(0);
}
if (!process.argv.includes('--live'))
    throw Error('Usá --dry-run para validar sin red o --live para autorizar llamadas reales.');
let key = process.env.GROQ_API_KEY?.trim() || '';
if (!key) {
    const rl = createInterface({ input: process.stdin, terminal: false });
    for await (const line of rl) {
        key = line.trim();
        rl.close();
        break;
    }
}
if (!/^gsk_[A-Za-z0-9_-]+$/.test(key))
    throw Error('KEY_FORMAT_REJECTED');
const results = [], rawResponses = [];
let lastChat = 0;
const evidence = { date: today, execution: 'local_direct_REST', syntheticOnly: true, productionChanged: false, models: { extraction: 'qwen/qwen3.8-27b', transcription: 'whisper-large-v3-turbo' }, results };
async function request(path, body, signal) { const res = await fetch('https://api.groq.com/openai/v1/' + path, { method: 'POST', headers: { authorization: 'Bearer ' + key, ...(body instanceof FormData ? {} : { 'content-type': 'application/json' }) }, body: body instanceof FormData ? body : JSON.stringify(body), signal }); const r = res.body.getReader(), chunks = []; let len = 0; try {
    while (true) {
        const p = await r.read();
        if (p.done)
            break;
        len += p.value.length;
        if (len > 262144)
            throw Error('RESPONSE_LIMIT');
        chunks.push(p.value);
    }
}
finally {
    await r.cancel().catch(() => { });
    r.releaseLock();
} return { http: res.status, data: JSON.parse(Buffer.concat(chunks).toString('utf8')), quota: { requestsLimit: res.headers.get('x-ratelimit-limit-requests'), requestsRemaining: res.headers.get('x-ratelimit-remaining-requests'), tokensLimit: res.headers.get('x-ratelimit-limit-tokens'), tokensRemaining: res.headers.get('x-ratelimit-remaining-tokens') } }; }
for (const test of cases) {
    const pause = 25000 - (Date.now() - lastChat);
    if (pause > 0)
        await new Promise(r => setTimeout(r, pause));
    const result = { case: test.id, mode: test.mode };
    const started = performance.now(), whole = AbortSignal.timeout(30000);
    try {
        let text = test.text || '';
        if (test.audio) {
            const f = new FormData();
            f.append('file', new Blob([fixtures.audio], { type: 'audio/wav' }), 'synthetic.wav');
            f.append('model', 'whisper-large-v3-turbo');
            f.append('language', 'es');
            f.append('response_format', 'json');
            const t0 = performance.now();
            const trans = await request('audio/transcriptions', f, AbortSignal.any([whole, AbortSignal.timeout(10000)]));
            result.transcriptionHttp = trans.http;
            result.transcriptionMs = Math.round(performance.now() - t0);
            if (trans.http !== 200 || typeof trans.data.text !== 'string') {
                result.reason = 'TRANSCRIPTION_FAILURE';
                throw Error('CONTROLLED');
            }
            text = trans.data.text.trim();
        }
        let prompt = makePrompt({ text, activeDraftContext: test.draft || 'Sin movimientos pendientes actualmente.' }, today);
        if (test.mode === 'original')
            prompt += '\nDevolvé únicamente JSON conforme a este esquema: ' + JSON.stringify(schema);
        else
            prompt += addedRules + '\nDevolvé únicamente el objeto JSON solicitado.';
        const content = test.image ? [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: 'data:image/png;base64,' + fixtures.image.toString('base64') } }] : prompt;
        lastChat = Date.now();
        const t0 = performance.now();
        const response = await request('chat/completions', { model: 'qwen/qwen3.8-27b', messages: [{ role: 'user', content }], response_format: test.mode === 'original' ? { type: 'json_object' } : { type: 'json_schema', json_schema: { name: 'pesito_movements', strict: true, schema: strict } }, max_completion_tokens: 4096, temperature: 0.1 }, AbortSignal.any([whole, AbortSignal.timeout(10000)]));
        result.http = response.http;
        result.extractionMs = Math.round(performance.now() - t0);
        result.quota = response.quota;
        if (response.http !== 200) {
            result.reason = response.http === 429 ? 'RATE_LIMIT' : response.http >= 500 ? 'UNAVAILABLE' : 'REQUEST_REJECTED';
            throw Error('CONTROLLED');
        }
        const parsed = JSON.parse(response.data.choices?.[0]?.message?.content || '');
        rawResponses.push({ case: test.id, mode: test.mode, response: parsed });
        result.rawSchemaErrors = errors(parsed, schema);
        result.strictSchemaErrors = test.mode === 'strict_candidate' ? errors(parsed, strict) : undefined;
        const adapted = normalize(parsed);
        result.adaptedSchemaErrors = errors(adapted, schema);
        result.intent = schema.properties.intent.enum.includes(parsed.intent) ? parsed.intent : 'unrecognized';
        result.movementCount = Array.isArray(parsed.movements) ? parsed.movements.length : null;
        const differences = [];
        if (result.adaptedSchemaErrors.length === 0) {
            if (test.edit) {
                if (adapted.intent !== 'edit_item')
                    differences.push('intent');
                if (adapted.edit?.targetPosition !== test.edit.position)
                    differences.push('edit.targetPosition');
                if (adapted.edit?.amount !== test.edit.amount)
                    differences.push('edit.amount');
                if (adapted.movements.length)
                    differences.push('unexpected_movements');
            }
            else if (test.missing) {
                if (adapted.intent !== 'add_movements' || adapted.movements.length !== 1 || adapted.movements[0].totalAmountArs !== null || !adapted.movements[0].missingFields.includes('amount'))
                    differences.push('missing_amount_preservation');
            }
            else {
                const actual = adapted.movements.map(m => [m.kind, m.totalAmountArs, m.currency, m.installments]).sort();
                if (adapted.intent !== 'add_movements')
                    differences.push('intent');
                if (JSON.stringify(actual) !== JSON.stringify([...test.expected].sort()))
                    differences.push('kind_amount_currency_installments');
                if (!adapted.movements.every(m => typeof m.description === 'string' && m.description.trim()))
                    differences.push('description');
                if (!adapted.movements.every(m => m.occurredOn === today))
                    differences.push('date');
                if (!adapted.movements.every(m => m.missingFields.length === 0))
                    differences.push('unexpected_missing_fields');
            }
        }
        result.differences = differences;
        result.correct = result.adaptedSchemaErrors.length === 0 && differences.length === 0 && (test.mode !== 'strict_candidate' || result.strictSchemaErrors.length === 0);
        result.promptTokens = response.data.usage?.prompt_tokens;
        result.completionTokens = response.data.usage?.completion_tokens;
    }
    catch (e) {
        if (!result.reason)
            result.reason = e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'TIMEOUT' : e instanceof SyntaxError ? 'INVALID_JSON' : 'CLIENT_FAILURE';
        result.correct = false;
    }
    result.totalMs = Math.round(performance.now() - started);
    results.push(result);
    console.log(JSON.stringify(result));
    await writeFile(new URL('.temp/groq-review/results.json', root), JSON.stringify(evidence, null, 2) + '\n');
    await writeFile(new URL('.temp/groq-review/synthetic-responses.json', root), JSON.stringify(rawResponses, null, 2) + '\n');
    if (result.http === 401 || result.http === 403)
        break;
}
key = '';
