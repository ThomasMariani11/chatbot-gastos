// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { PwaUpdater } from '../src/pwaUpdateCoordinator';
const instances: PwaUpdater[] = [];
afterEach(() => { instances.splice(0).forEach(updater => updater.stop()); document.body.innerHTML = ''; vi.useRealTimers(); });
async function flush() { for (let i = 0; i < 10; i++) await Promise.resolve(); }
function setup() {
  const response = (body: unknown, type = 'application/json') => new Response(typeof body === 'string' ? body : JSON.stringify(body), { headers: { 'content-type': type } });
  const fetcher = vi.fn(async (url: string | URL | Request) => String(url).includes('version.json') ? response({ version: 'bbbbbbb' }) : response('<html>Pesito</html>', 'text/html'));
  const reload = vi.fn(), sw = new EventTarget() as ServiceWorkerContainer;
  const worker = new EventTarget() as ServiceWorker;
  const postMessage = vi.fn(() => sw.dispatchEvent(new Event('controllerchange')));
  Object.assign(worker, { state: 'installed', postMessage });
  const registration = new EventTarget() as ServiceWorkerRegistration;
  Object.assign(registration, { update: vi.fn(async () => undefined), waiting: worker, installing: null });
  Object.assign(sw, { register: vi.fn(async () => registration), controller: {} });
  Object.defineProperty(document, 'readyState', { configurable: true, value: 'complete' });
  const updater = new PwaUpdater({ window, document, serviceWorker: sw, fetch: fetcher as typeof fetch, base: '/chatbot-gastos/', version: 'aaaaaaa', reload, timeoutMs: 50 });
  instances.push(updater); return { updater, sw, worker, registration, postMessage, fetcher, reload, response };
}
describe('actualizaciones explícitas sin perder formularios', () => {
  it('versionado, activación, foco, conexión y eventos repetidos generan estado único sin recarga ni activación forzada', async () => {
    const s = setup(); s.updater.start(); await flush(); for (let i = 0; i < 3; i++) { s.sw.dispatchEvent(new Event('controllerchange')); window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')); }
    await flush(); expect(s.updater.snapshot().available).toBe(true); expect(s.reload).not.toHaveBeenCalled(); expect(s.postMessage).not.toHaveBeenCalled();
  });
  it('un borrador bloquea la acción; al cerrarlo no recarga hasta otro clic', async () => {
    const s = setup(); s.updater.start(); await flush(); const owner = Symbol(); s.updater.block(owner, 'Formulario abierto');
    expect(await s.updater.apply()).toBe(false); s.updater.block(owner, null); await flush(); expect(s.reload).not.toHaveBeenCalled();
    expect(await s.updater.apply()).toBe(true); expect(s.postMessage).toHaveBeenCalledTimes(1); expect(s.reload).toHaveBeenCalledTimes(1); expect(await s.updater.apply()).toBe(false);
  });
  it('diálogos administrativos y accesibles bloquean aunque falte una guardia nueva', async () => {
    const s = setup(); s.updater.start(); await flush(); for (const html of ['<div class="admin-modal-backdrop"></div>', '<div role="dialog"></div>', '<div aria-busy="true"></div>']) {
      document.body.innerHTML = html; expect(await s.updater.apply()).toBe(false);
    } expect(s.reload).not.toHaveBeenCalled();
  });
  it('revalida si el usuario abre una edición mientras descarga', async () => {
    const s = setup(); s.updater.start(); await flush(); s.fetcher.mockImplementation(async url => {
      if (!String(url).includes('version.json')) s.updater.block(Symbol(), 'Edición nueva');
      return String(url).includes('version.json') ? s.response({ version: 'bbbbbbb' }) : s.response('<html></html>', 'text/html');
    }); expect(await s.updater.apply()).toBe(false); expect(s.reload).not.toHaveBeenCalled(); expect(s.postMessage).not.toHaveBeenCalled();
  });
  it('fallo de red, HTML inválido o instalación fallida conserva estado y permite reintento', async () => {
    const s = setup(); s.updater.start(); await flush(); s.fetcher.mockRejectedValueOnce(Error('network')); expect(await s.updater.apply()).toBe(false);
    expect(s.updater.snapshot().applying).toBe(false); expect(s.updater.snapshot().error).toContain('Tus cambios siguen'); expect(s.reload).not.toHaveBeenCalled();
    s.fetcher.mockImplementationOnce(async () => s.response({ version: 'bbbbbbb' })).mockImplementationOnce(async () => s.response('bad'));
    expect(await s.updater.apply()).toBe(false); expect(await s.updater.apply()).toBe(true);
  });
  it('timeout de activación no deja el botón ocupado ni recarga', async () => {
    vi.useFakeTimers(); const s = setup(); s.updater.start(); await flush(); s.postMessage.mockImplementation(() => false);
    const apply = s.updater.apply(); await vi.advanceTimersByTimeAsync(60); expect(await apply).toBe(false); expect(s.reload).not.toHaveBeenCalled(); expect(s.updater.snapshot().applying).toBe(false);
  });
  it('StrictMode limpia listeners y temporizadores; detener invalida una respuesta tardía', async () => {
    const s = setup(), remove = vi.spyOn(window, 'removeEventListener'); s.updater.start(); s.updater.stop(); s.updater.start(); await flush();
    expect(remove).toHaveBeenCalledWith('focus', expect.any(Function)); expect(remove).toHaveBeenCalledWith('online', expect.any(Function));
    s.updater.stop(); s.sw.dispatchEvent(new Event('controllerchange')); const before = s.updater.snapshot(); window.dispatchEvent(new Event('focus')); await flush(); expect(s.updater.snapshot()).toBe(before); expect(s.reload).not.toHaveBeenCalled();
  });
  it('primera instalación sin controlador no anuncia una actualización inexistente', async () => {
    const s = setup(); Object.assign(s.sw, { controller: null, register: vi.fn(async () => ({ ...s.registration, waiting: null, update: vi.fn(async () => undefined), addEventListener: vi.fn(), removeEventListener: vi.fn() })) });
    s.fetcher.mockImplementation(async () => s.response({ version: 'aaaaaaa' })); s.updater.start(); await flush();
    s.sw.dispatchEvent(new Event('controllerchange')); expect(s.updater.snapshot().available).toBe(false); expect(s.reload).not.toHaveBeenCalled();
  });
  it('sin conexión no empieza a activar ni borra el estado disponible', async () => {
    const s = setup(); s.updater.start(); await flush(); Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false });
    try { expect(await s.updater.apply()).toBe(false); expect(s.postMessage).not.toHaveBeenCalled(); expect(s.reload).not.toHaveBeenCalled(); expect(s.updater.snapshot().available).toBe(true); }
    finally { Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true }); }
  });
  it('detener durante una descarga invalida el resultado aunque después resuelva', async () => {
    const s = setup(); s.updater.start(); await flush(); let release!: (value: Response) => void;
    s.fetcher.mockImplementationOnce(() => new Promise<Response>(resolve => { release = resolve; }));
    const apply = s.updater.apply(); s.updater.stop(); release(s.response({ version: 'bbbbbbb' })); expect(await apply).toBe(false); expect(s.reload).not.toHaveBeenCalled();
  });
  it('un worker que rechaza la activación libera el listener y permite reintentar', async () => {
    const s = setup(); s.updater.start(); await flush(); const remove = vi.spyOn(s.sw, 'removeEventListener');
    s.postMessage.mockImplementationOnce(() => { throw Error('redundant'); });
    expect(await s.updater.apply()).toBe(false); expect(remove).toHaveBeenCalledWith('controllerchange', expect.any(Function));
    expect(await s.updater.apply()).toBe(true); expect(s.reload).toHaveBeenCalledTimes(1);
  });
  it('doble clic aplica y recarga una sola vez', async () => {
    const s = setup(); s.updater.start(); await flush(); const first = s.updater.apply(); expect(await s.updater.apply()).toBe(false); expect(await first).toBe(true); expect(s.reload).toHaveBeenCalledTimes(1);
  });
});
