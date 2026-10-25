export type UpdateState = Readonly<{ available: boolean; applying: boolean; reason: string; error: string }>;
type Options = { window: Window; document: Document; serviceWorker?: ServiceWorkerContainer; fetch: typeof fetch; base: string; version: string; reload: () => void; timeoutMs?: number };
const initial: UpdateState = { available: false, applying: false, reason: '', error: '' };

// Los eventos anuncian; únicamente apply(), por decisión del usuario, puede recargar.
export class PwaUpdater {
  private state = initial;
  private listeners = new Set<() => void>();
  private blockers = new Map<symbol, string>();
  private cleanups: Array<() => void> = [];
  private registration: ServiceWorkerRegistration | null = null;
  private running = false;
  private generation = 0;
  private checking = false;
  private reloaded = false;
  private lifecycle = new AbortController();
  private timer?: number;
  readonly subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  readonly snapshot = () => this.state;
  constructor(private options: Options) {}
  private publish(patch: Partial<UpdateState>) {
    const next = { ...this.state, ...patch };
    if (Object.keys(next).every(key => next[key as keyof UpdateState] === this.state[key as keyof UpdateState])) return;
    this.state = next;
    this.listeners.forEach(listener => listener());
  }
  block(owner: symbol, reason: string | null) {
    if (reason) this.blockers.set(owner, reason); else this.blockers.delete(owner);
    this.publish({ reason: this.blockers.values().next().value ?? '' });
  }
  private listen(target: EventTarget, type: string, handler: EventListener) {
    target.addEventListener(type, handler);
    this.cleanups.push(() => target.removeEventListener(type, handler));
  }
  private announce() { this.publish({ available: true }); }
  start() {
    if (this.running) return;
    this.running = true;
    this.checking = false;
    this.lifecycle = new AbortController();
    const generation = ++this.generation;
    const current = () => this.running && generation === this.generation;
    const { window: win, document: doc, serviceWorker: sw } = this.options;
    if (sw) {
      let hadController = Boolean(sw.controller);
      this.listen(sw, 'controllerchange', () => {
        if (!current()) return;
        if (!hadController) { hadController = true; return; }
        this.announce();
      });
      this.listen(sw, 'message', ((event: MessageEvent) => {
        if (current() && event.data?.type === 'SW_ACTIVATED' && event.data.version !== this.options.version) this.announce();
      }) as EventListener);
      const register = async () => {
        try {
          const registration = await sw.register(this.options.base + 'sw.js', { scope: this.options.base, updateViaCache: 'none' });
          if (!current()) return;
          this.registration = registration;
          const watch = () => {
            if (registration.waiting && sw.controller) this.announce();
            const worker = registration.installing;
            if (worker) this.listen(worker, 'statechange', () => {
              if (current() && worker.state === 'installed' && sw.controller) this.announce();
            });
          };
          watch();
          this.listen(registration, 'updatefound', watch);
          void registration.update().catch(() => undefined);
        } catch { /* Offline no impide usar la app. */ }
      };
      if (doc.readyState === 'complete') void register();
      else this.listen(win, 'load', () => { void register(); });
    }
    const check = () => { if (doc.visibilityState !== 'hidden') void this.check(); };
    this.timer = win.setInterval(check, 15000);
    this.listen(win, 'focus', check);
    this.listen(win, 'online', check);
    this.listen(doc, 'visibilitychange', check);
    check();
  }
  stop() {
    this.running = false;
    this.generation++;
    this.lifecycle.abort();
    this.cleanups.splice(0).forEach(cleanup => cleanup());
    if (this.timer !== undefined) this.options.window.clearInterval(this.timer);
    this.registration = null;
    this.publish({ applying: false });
  }
  private async bounded<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController(), lifecycle = this.lifecycle.signal;
    let timer: ReturnType<typeof setTimeout>;
    let onAbort: () => void = () => undefined;
    const interrupted = new Promise<never>((_, reject) => {
      onAbort = () => { controller.abort(); reject(new Error('interrupted')); };
      lifecycle.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(onAbort, this.options.timeoutMs ?? 10000);
    });
    try {
      if (lifecycle.aborted) throw new Error('interrupted');
      return await Promise.race([work(controller.signal), interrupted]);
    } finally { clearTimeout(timer!); lifecycle.removeEventListener('abort', onAbort); }
  }
  private async remoteVersion() {
    return this.bounded(async signal => {
      const response = await this.options.fetch(this.options.base + 'version.json?t=' + Date.now(), { cache: 'no-store', signal });
      if (!response.ok) throw new Error('version unavailable');
      const data = await response.json() as { version?: unknown };
      if (typeof data.version !== 'string' || !/^[a-f0-9]{7,64}$/i.test(data.version)) throw new Error('invalid version');
      return data.version;
    });
  }
  async check() {
    if (!this.running || this.checking || this.state.applying || this.options.version === 'dev') return;
    this.checking = true;
    const generation = this.generation;
    try {
      const version = await this.remoteVersion();
      if (this.running && generation === this.generation && version !== this.options.version) this.announce();
    } catch { /* No abrir errores repetidos por sondeos sin conexión. */ }
    finally { if (generation === this.generation) this.checking = false; }
  }
  private assertSafe() {
    if (!this.running || this.lifecycle.signal.aborted || this.blockers.size) throw new Error('editing');
    if (this.options.document.querySelector('.modal-backdrop, .admin-modal-backdrop, [role="dialog"], dialog[open], [aria-busy="true"]')) throw new Error('editing');
    if (this.options.window.navigator.onLine === false) throw new Error('offline');
  }
  private async finishInstall(worker: ServiceWorker) {
    await this.bounded(signal => new Promise<void>((resolve, reject) => {
      const clean = () => { worker.removeEventListener('statechange', change); signal.removeEventListener('abort', abort); };
      const abort = () => { clean(); reject(new Error('interrupted')); };
      const change = () => {
        if (worker.state === 'installed' || worker.state === 'activated') { clean(); resolve(); }
        else if (worker.state === 'redundant') { clean(); reject(new Error('install failed')); }
      };
      worker.addEventListener('statechange', change);
      signal.addEventListener('abort', abort, { once: true });
      change();
    }));
  }
  private async activate(worker: ServiceWorker) {
    const sw = this.options.serviceWorker!;
    await this.bounded(signal => new Promise<void>((resolve, reject) => {
      const clean = () => { sw.removeEventListener('controllerchange', change); signal.removeEventListener('abort', abort); };
      const change = () => { clean(); resolve(); };
      const abort = () => { clean(); reject(new Error('activation failed')); };
      sw.addEventListener('controllerchange', change);
      signal.addEventListener('abort', abort, { once: true });
      try { worker.postMessage({ type: 'SKIP_WAITING' }); }
      catch (error) { clean(); reject(error); }
    }));
  }
  async apply(): Promise<boolean> {
    if (!this.running || !this.state.available || this.state.applying || this.reloaded) return false;
    const generation = this.generation;
    try { this.assertSafe(); }
    catch { this.publish({ error: 'Guardá o cerrá lo que estás editando y comprobá tu conexión antes de actualizar.' }); return false; }
    this.publish({ applying: true, error: '' });
    try {
      await this.remoteVersion();
      if (this.registration) {
        await this.bounded(() => this.registration!.update());
        const installing = this.registration.installing;
        if (installing) await this.finishInstall(installing);
      }
      await this.bounded(async signal => {
        const response = await this.options.fetch(this.options.base, { cache: 'reload', signal });
        if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) throw new Error('page unavailable');
        await response.text();
      });
      this.assertSafe();
      const waiting = this.registration?.waiting;
      if (waiting) await this.activate(waiting);
      this.assertSafe();
      if (generation !== this.generation) return false;
      this.reloaded = true;
      this.options.reload();
      return true;
    } catch {
      if (this.running && generation === this.generation) this.publish({ applying: false, error: 'No pudimos actualizar. Tus cambios siguen acá. Comprobá tu conexión y volvé a intentar.' });
      return false;
    }
  }
}
