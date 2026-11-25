import { describe, expect, it, vi } from 'vitest';
import { runActor, type Job, type QueueDependencies } from '../supabase/functions/whatsapp-webhook/queue';

// SEC-04: que un cliente llegue a su límite diario de IA es el límite funcionando, no una falla operativa.
// No se registra como incidencia (el panel ya lo muestra en el top 5). El cupo global agotado sí se registra.
const job: Job = {
  id: '99000000-0000-4000-8000-000000000055',
  wa_id: 'wa-ficticio',
  user_id: '99000000-0000-4000-8000-000000000056',
  payload: { id: 'wamid-ficticio', from: 'wa-ficticio', type: 'audio', audio: { id: 'media-ficticio' } },
  attempts: 1,
  effect_applied: false,
  reply_text: null,
  parsed_result: null,
} as unknown as Job;

async function run(requestTextReason: string) {
  const issues: unknown[] = [];
  const metrics: string[] = [];
  let served = false;
  const deps: QueueDependencies = {
    rpc: vi.fn(async (name: string, args?: Record<string, unknown>) => {
      if (name === 'claim_whatsapp_actor') return true;
      if (name === 'next_whatsapp_job') { if (served) return null; served = true; return job; }
      if (name === 'record_whatsapp_job_issue') { issues.push(args?.p_issue); return null; }
      if (name === 'apply_whatsapp_job') return { ...job, effect_applied: true, reply_text: 'Respuesta ficticia' };
      return null;
    }) as never,
    prepare: vi.fn(async (_job, checkpoint) => {
      await checkpoint({
        intent: 'request_text',
        movements: [],
        requestTextReason,
        operationalFailure: { reason: 'rate_limit', provider: 'groq' },
      });
      return { kind: 'reply', text: 'ficticio' };
    }) as never,
    send: vi.fn(async () => undefined) as never,
    format: vi.fn() as never,
    now: () => Date.now(),
    sleep: vi.fn(async () => undefined) as never,
    token: () => '99000000-0000-4000-8000-000000000057',
    metric: vi.fn((event: string) => { metrics.push(event); }) as never,
  };
  await runActor('wa-ficticio', deps);
  return { issues, metrics };
}

describe('SEC-04: el límite del cliente no se registra como incidencia', () => {
  it.each(['user_quota_audio', 'user_quota_text'])('%s no registra una incidencia de aclaración', async (reason) => {
    const { issues, metrics } = await run(reason);
    expect(issues).toEqual([]);
    expect(metrics).toContain('queue_clarification');
  });

  it('el cupo global agotado sigue registrándose como incidencia', async () => {
    const { issues } = await run('quota');
    expect(issues).toEqual([expect.objectContaining({ kind: 'clarification', reason: 'rate_limit', provider: 'groq' })]);
  });
});
