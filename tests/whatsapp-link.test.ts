import { beforeEach, describe, expect, it, vi } from 'vitest';
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../src/supabase', () => ({ supabase: { rpc } }));
import { requestWhatsAppLinkCode } from '../src/whatsappLink';

beforeEach(() => rpc.mockReset());
describe('contrato de vinculación de la PWA', () => {
  it('solicita un código sin enviar identidad, teléfono ni vencimiento', async () => {
    rpc.mockResolvedValue({ data:{code:'123456',expires_at:'2026-10-14T23:00:00Z'}, error:null });
    expect(await requestWhatsAppLinkCode()).toEqual({code:'123456',expiresAt:'2026-10-14T23:00:00Z'});
    expect(rpc).toHaveBeenCalledWith('request_whatsapp_link_code');
  });
  it('no muestra errores internos del servidor', async () => {
    rpc.mockResolvedValue({data:null,error:{message:'internal database detail'}});
    await expect(requestWhatsAppLinkCode()).rejects.toThrow('No pudimos generar el código');
  });
  it.each([null,{}, {code:'bad',expires_at:'2026-10-14'}, {code:123456,expires_at:'2026-10-14'}, {code:'123456',expires_at:'invalid'}])('rechaza respuestas incompletas o inválidas: %j', async data => {
    rpc.mockResolvedValue({data,error:null});
    await expect(requestWhatsAppLinkCode()).rejects.toThrow('No recibimos un código');
  });
});
