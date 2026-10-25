import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
const base = 'https://example.test/chatbot-gastos/';
function worker() {
  const handlers = new Map<string, (event: Record<string, unknown>) => void>();
  const bins = new Map<string, Map<string, Response>>();
  const cache = (name: string) => { if (!bins.has(name)) bins.set(name, new Map()); return { put: async (key: string | Request, value: Response) => { bins.get(name)!.set(typeof key === 'string' ? key : key.url, value); } }; };
  const match = vi.fn(async (key: string | Request) => { const url = typeof key === 'string' ? key : key.url; for (const bin of bins.values()) if (bin.has(url)) return bin.get(url)!.clone(); return undefined; });
  const remove = vi.fn(async (key: string) => bins.delete(key));
  const pages = [{ url: base, postMessage: vi.fn() }];
  const fetcher = vi.fn(async (input: string | Request) => new Response((typeof input === 'string' ? input : input.url) === base ? '<html><script src="/chatbot-gastos/assets/new.js"></script><link href="/chatbot-gastos/assets/new.css" rel="stylesheet"></html>' : 'asset', { headers: { 'content-type': 'text/html' } }));
  const skipWaiting = vi.fn();
  vm.runInNewContext(source, { self: { registration: { scope: base }, location: { origin: 'https://example.test' }, clients: { matchAll: async () => pages, claim: vi.fn() }, skipWaiting, addEventListener: (name: string, fn: (event: Record<string, unknown>) => void) => handlers.set(name, fn) }, caches: { open: async (name: string) => cache(name), match, keys: async () => [...bins.keys()], delete: remove }, URL, Response, fetch: fetcher });
  async function lifecycle(name: string) { let pending!: Promise<void>; handlers.get(name)!({ waitUntil: (work: Promise<void>) => { pending = work; } }); await pending; }
  async function request(url: string, mode = 'cors', requestCache = 'default') { let pending: Promise<Response> | undefined; handlers.get('fetch')!({ request: { url, method: 'GET', mode, cache: requestCache }, waitUntil: () => undefined, respondWith: (work: Promise<Response>) => { pending = work; } }); return pending; }
  return { handlers, bins, cache, match, remove, pages, fetcher, skipWaiting, lifecycle, request };
}
describe('service worker real: instalación segura y caché compatible', () => {
  it('descarga HTML y assets antes de instalar y nunca fuerza activar en install', async () => {
    const s = worker(); await s.lifecycle('install'); expect(s.skipWaiting).not.toHaveBeenCalled();
    expect(s.fetcher.mock.calls.map(call => call[0])).toContain(base + 'assets/new.js'); expect(s.fetcher.mock.calls.map(call => call[0])).toContain(base + 'assets/new.css');
    s.handlers.get('message')!({ data: { type: 'SKIP_WAITING' } }); expect(s.skipWaiting).toHaveBeenCalledTimes(1);
  });
  it('si falla un asset rechaza la instalación sin activar la versión incompleta', async () => {
    const s = worker(); const original = s.fetcher.getMockImplementation()!; s.fetcher.mockImplementation(async input => String(input).endsWith('new.js') ? new Response('bad', { status: 503 }) : original(input));
    await expect(s.lifecycle('install')).rejects.toThrow('asset unavailable'); expect(s.skipWaiting).not.toHaveBeenCalled();
  });
  it('con otra pestaña conserva sus cachés y nunca elimina cachés ajenas', async () => {
    const s = worker(); s.cache('pesito-github-old'); s.cache('other-app-cache'); s.pages.push({ url: base + '#settings', postMessage: vi.fn() }); await s.lifecycle('activate'); expect(s.remove).not.toHaveBeenCalled();
  });
  it('con una sola pestaña limpia únicamente versiones anteriores de Pesito', async () => {
    const s = worker(); s.cache('pesito-github-old'); s.cache('other-app-cache'); await s.lifecycle('activate'); expect(s.remove).toHaveBeenCalledWith('pesito-github-old'); expect(s.remove).not.toHaveBeenCalledWith('other-app-cache');
  });
  it('no intercepta Supabase; la versión y la comprobación explícita siempre van a red', async () => {
    const s = worker(); expect(await s.request('https://supabase.example/rest/v1/profiles')).toBeUndefined(); await s.request(base + 'version.json'); await s.request(base, 'cors', 'reload'); expect(s.match).not.toHaveBeenCalled();
  });
  it('offline devuelve assets guardados y HTML solo para navegaciones', async () => {
    const s = worker(); await s.lifecycle('install'); s.fetcher.mockRejectedValue(Error('offline'));
    expect(await (await s.request(base + 'assets/new.js'))!.text()).toBe('asset'); expect((await s.request(base + 'assets/missing.js'))!.type).toBe('error'); expect(await (await s.request(base + 'other', 'navigate'))!.text()).toContain('<html>');
  });
});
