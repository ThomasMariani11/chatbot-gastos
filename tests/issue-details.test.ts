import {describe,it,expect} from 'vitest';
import {issueTimestamp,issueDescription,safeClientName} from '../supabase/functions/whatsapp-webhook/issue-details';
import type {OperationalIssue} from '../supabase/functions/whatsapp-webhook/issue-details';
describe('diagnóstico compartido de administrador y WhatsApp',()=>{
 it('usa fecha y hora de Argentina, inclusive al cambiar el día',()=>{expect(issueTimestamp('2026-10-23T01:05:06Z')).toContain('22/10/2026');expect(issueTimestamp('2026-10-23T01:05:06Z')).toContain('22:05:06');expect(issueTimestamp('invalid')).toBe('Fecha no registrada');});
 it('elimina controles, saltos, bidi y formato WhatsApp del nombre',()=>{expect(safeClientName('  *Cliente*\n_ Ficticio_\u202E  ')).toBe('Cliente Ficticio');expect(safeClientName('a'.repeat(1000))).toHaveLength(120);expect(safeClientName(null)).toBe('Cliente sin nombre');});
 it('no convierte campos ajenos en mensajes de error visibles',()=>{const issue={diagnostic_available:true,stage:'PRIVATE_STAGE',provider:'PRIVATE_PROVIDER',reason:'PRIVATE_REASON',operation:'PRIVATE_OPERATION',status:9999} as OperationalIssue;expect(issueDescription(issue)).not.toContain('PRIVATE_');expect(issueDescription(issue)).not.toContain('9999');});
 it('no inventa causas ni horarios de error para registros antiguos',()=>{expect(issueDescription({diagnostic_available:false,reason:'unavailable'} as OperationalIssue)).toContain('no registrada');});
});
