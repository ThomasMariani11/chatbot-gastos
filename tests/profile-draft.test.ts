import { describe, it, expect, vi } from 'vitest';
import { ProfileDraft, type ProfileRecord } from '../src/profileDraft';
const user = 'person-a', record = { id: user, first_name: 'Ana', last_name: 'Prueba' };
function setup(write = vi.fn(async (_id: string, names: { first_name: string; last_name: string }) => ({ id: user, ...names }))) {
  const draft = new ProfileDraft(user, write, 25); draft.receive(record); return { draft, write };
}
function deferred() { let resolve!: (value: ProfileRecord) => void; const promise = new Promise<ProfileRecord>(r => { resolve = r; }); return { promise, resolve }; }
describe('borrador personal separado del perfil remoto', () => {
  it('el refresco del mismo perfil y de la suscripción no borra lo escrito', () => {
    const { draft } = setup(); draft.edit('first_name', 'Anita'); draft.receive({ ...record });
    expect(draft.snapshot().value.first_name).toBe('Anita'); expect(draft.snapshot().dirty).toBe(true); expect(draft.snapshot().conflict).toBe(false);
  });
  it('un cambio remoto conserva el borrador, avisa y permite elegir el remoto', () => {
    const { draft } = setup(); draft.edit('first_name', 'Anita'); draft.receive({ ...record, last_name: 'Remoto' });
    expect(draft.snapshot().value).toEqual({ first_name: 'Anita', last_name: 'Prueba' }); expect(draft.snapshot().conflict).toBe(true);
    draft.discard(); expect(draft.snapshot().value).toEqual({ first_name: 'Ana', last_name: 'Remoto' }); expect(draft.snapshot().dirty).toBe(false);
  });
  it('sin edición local incorpora cambios remotos e ignora perfiles ajenos o ausentes', () => {
    const { draft } = setup(); draft.receive({ ...record, first_name: 'Actualizada' }); draft.receive(null); draft.receive({ ...record, id: 'person-b' });
    expect(draft.snapshot().value.first_name).toBe('Actualizada'); expect(draft.snapshot().dirty).toBe(false);
  });
  it('un guardado confirma la fila real, excluye doble envío y congela los campos', async () => {
    const wait = deferred(), write = vi.fn(() => wait.promise), draft = new ProfileDraft(user, write); draft.receive(record); draft.edit('first_name', ' Anita ');
    const one = draft.save(); expect(await draft.save()).toBe(false); draft.edit('first_name', 'Cambio durante envío'); draft.discard();
    expect(write).toHaveBeenCalledTimes(1); expect(draft.snapshot().value.first_name).toBe(' Anita ');
    wait.resolve({ ...record, first_name: 'Anita' }); expect(await one).toBe(true); expect(draft.snapshot().dirty).toBe(false); expect(draft.snapshot().value.first_name).toBe('Anita');
  });
  it('una respuesta de lectura anterior no pisa el nombre recién guardado', async () => {
    const { draft } = setup(); draft.edit('first_name', 'Anita'); await draft.save(); draft.receive(record);
    expect(draft.snapshot().value.first_name).toBe('Anita'); draft.receive({ ...record, first_name: 'Anita' }); expect(draft.snapshot().conflict).toBe(false);
  });
  it('rechazos y falta de fila conservan cambios y no anuncian éxito', async () => {
    for (const response of [() => Promise.reject(Error('PRIVATE_DETAIL')), () => Promise.resolve(null), () => Promise.resolve({ ...record, id: 'other' })]) {
      const draft = new ProfileDraft(user, response as never); draft.receive(record); draft.edit('last_name', 'Local'); expect(await draft.save()).toBe(false);
      expect(draft.snapshot().dirty).toBe(true); expect(draft.snapshot().message).toBe(''); expect(draft.snapshot().error).not.toContain('PRIVATE_DETAIL'); expect(draft.snapshot().value.last_name).toBe('Local');
    }
  });
  it('timeout desbloquea para reintentar sin borrar el borrador', async () => {
    const draft = new ProfileDraft(user, () => new Promise(() => undefined), 5); draft.receive(record); draft.edit('first_name', 'Anita');
    expect(await draft.save()).toBe(false); expect(draft.snapshot().saving).toBe(false); expect(draft.snapshot().dirty).toBe(true);
  });
  it('salir invalida respuestas tardías y otro usuario tiene un borrador separado', async () => {
    const wait = deferred(), draft = new ProfileDraft(user, () => wait.promise); draft.receive(record); draft.edit('first_name', 'Anita');
    const saving = draft.save(); draft.deactivate(); wait.resolve({ ...record, first_name: 'Anita' }); expect(await saving).toBe(false);
    const other = new ProfileDraft('person-b', vi.fn()); other.receive({ id: 'person-b', first_name: 'Bea', last_name: '' }); expect(other.snapshot().value.first_name).toBe('Bea');
    draft.activate(); expect(draft.snapshot().dirty).toBe(true);
  });
});
