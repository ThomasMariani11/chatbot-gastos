export type ProfileNames = { first_name: string; last_name: string };
export type ProfileRecord = { id: string; first_name?: string | null; last_name?: string | null };
export type ProfileDraftState = Readonly<{ value: ProfileNames; dirty: boolean; conflict: boolean; saving: boolean; message: string; error: string }>;
export type NameWriter = (userId: string, names: ProfileNames, signal: AbortSignal) => Promise<ProfileRecord>;
const namesOf = (record: ProfileRecord): ProfileNames => ({ first_name: record.first_name ?? '', last_name: record.last_name ?? '' });
const same = (a: ProfileNames, b: ProfileNames) => a.first_name === b.first_name && a.last_name === b.last_name;
const trim = (names: ProfileNames): ProfileNames => ({ first_name: names.first_name.trim(), last_name: names.last_name.trim() });

// Vive en la sesión autenticada: conserva el borrador al navegar y se destruye al salir.
export class ProfileDraft {
  private base: ProfileNames = { first_name: '', last_name: '' };
  private remote = this.base;
  private acknowledged: ProfileNames | null = null;
  private state: ProfileDraftState = { value: this.base, dirty: false, conflict: false, saving: false, message: '', error: '' };
  private listeners = new Set<() => void>();
  private active = true;
  private generation = 0;
  private controller?: AbortController;
  readonly subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  readonly snapshot = () => this.state;
  constructor(readonly userId: string, private write: NameWriter, private timeoutMs = 15000) {}
  activate() { this.active = true; }
  deactivate() { this.active = false; this.generation++; this.controller?.abort(); this.update({ saving: false }); }
  private update(patch: Partial<ProfileDraftState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(listener => listener());
  }
  receive(record: ProfileRecord | null | undefined) {
    if (!record || record.id !== this.userId) return;
    const remote = namesOf(record);
    if (same(remote, this.remote) && !this.acknowledged) return;
    this.remote = remote;
    // Una lectura iniciada antes de guardar no debe borrar la respuesta confirmada.
    if (this.acknowledged) {
      if (!same(remote, this.acknowledged)) { this.update({ conflict: true }); return; }
      this.acknowledged = null;
    }
    if (this.state.dirty || this.state.saving) {
      this.update({ conflict: !same(remote, this.base) });
    } else {
      this.base = remote;
      this.update({ value: remote, conflict: false });
    }
  }
  edit(field: keyof ProfileNames, value: string) {
    if (!this.active || this.state.saving) return;
    const next = { ...this.state.value, [field]: value };
    this.update({ value: next, dirty: !same(trim(next), trim(this.base)), message: '', error: '' });
  }
  discard() {
    if (this.state.saving) return;
    this.base = this.remote;
    this.acknowledged = null;
    this.update({ value: this.remote, dirty: false, conflict: false, message: '', error: '' });
  }
  async save(): Promise<boolean> {
    if (!this.active || this.state.saving || !this.state.dirty) return false;
    const generation = this.generation, names = trim(this.state.value);
    const controller = new AbortController();
    this.controller = controller;
    this.update({ saving: true, message: '', error: '' });
    let timer: ReturnType<typeof setTimeout>;
    let abort: () => void = () => undefined;
    const interrupted = new Promise<never>((_, reject) => {
      abort = () => reject(new Error('interrupted'));
      controller.signal.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => controller.abort(), this.timeoutMs);
    });
    try {
      const record = await Promise.race([this.write(this.userId, names, controller.signal), interrupted]);
      if (!this.active || generation !== this.generation) return false;
      if (!record || record.id !== this.userId || typeof record.first_name !== 'string' || typeof record.last_name !== 'string') throw new Error('invalid result');
      const saved = namesOf(record);
      this.base = saved;
      this.acknowledged = saved;
      this.update({ value: saved, dirty: false, conflict: false, message: 'Datos personales guardados.', error: '' });
      return true;
    } catch {
      if (this.active && generation === this.generation) this.update({ error: 'No pudimos confirmar el guardado. Conservamos tus cambios; revisá tu conexión y volvé a intentar.' });
      return false;
    } finally {
      clearTimeout(timer!);
      controller.signal.removeEventListener('abort', abort);
      if (this.active && generation === this.generation) this.update({ saving: false });
    }
  }
}
