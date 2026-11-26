// 3.2 (LEG-01): "Tus datos" en Ajustes: descargar los movimientos y borrar la cuenta.
import { FormEvent, useState } from 'react';
import { supabase } from './supabase';
import { deleteAccount, downloadMovements, type DeleteResult } from './accountData';
import { markAccountDeleted } from './accountDeletedNotice';
import { unsubscribeBrowserPush } from './pushNotifications';
import { useUpdateBlocker } from './PwaUpdates';

type Props = {
  userId: string;
  email: string;
  isAdmin?: boolean;
  download?: (userId: string) => Promise<void>;
  remove?: (email: string, password: string) => Promise<DeleteResult>;
};

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
const realDownload = (userId: string) => downloadMovements(supabase, userId, today());
const realRemove = (email: string, password: string) =>
  deleteAccount({ client: supabase, email, password, unsubscribe: () => unsubscribeBrowserPush() });

const ERRORS: Record<Exclude<DeleteResult, 'deleted'>, string> = {
  wrong_password: 'La contraseña no es correcta.',
  denied: 'Esta cuenta no se puede borrar desde la app.',
  failed: 'No pude borrar la cuenta. No se borró nada; probá de nuevo más tarde.',
};

export function AccountDataCard({ userId, email, isAdmin, download = realDownload, remove = realRemove }: Props) {
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useUpdateBlocker(deleting);

  async function handleDownload() {
    setDownloading(true);
    setDownloadError(false);
    try { await download(userId); } catch { setDownloadError(true); } finally { setDownloading(false); }
  }

  function close() {
    if (deleting) return;
    setConfirming(false);
    setPassword('');
    setError(null);
  }

  async function handleDelete(event: FormEvent) {
    event.preventDefault();
    if (!password || deleting) return;
    setDeleting(true);
    setError(null);
    let result: DeleteResult;
    try { result = await remove(email, password); } catch { result = 'failed'; }
    if (result === 'deleted') {
      // La sesión ya se cerró: la app vuelve al ingreso, que muestra el aviso.
      markAccountDeleted();
      return;
    }
    setDeleting(false);
    setError(ERRORS[result]);
  }

  return (
    <article className="settings-panel">
      <h3>Tus datos</h3>
      <p>Descargá una copia de tus movimientos o borrá tu cuenta.</p>
      <div className="account-data-actions">
        <button type="button" className="button-secondary" onClick={() => void handleDownload()} disabled={downloading}>
          {downloading ? 'Preparando…' : 'Descargar mis movimientos'}
        </button>
        {isAdmin
          ? <p className="settings-muted">La cuenta de administrador no se borra desde la app.</p>
          : <button type="button" className="danger-button" onClick={() => setConfirming(true)}>Borrar mi cuenta</button>}
      </div>
      {downloadError && <p className="form-message form-message-error" role="alert">No pude preparar el archivo. Probá de nuevo.</p>}

      {confirming && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="delete-account-title" onClick={close}>
          <form className="movement-form account-delete-dialog" onSubmit={(e) => void handleDelete(e)} onClick={(e) => e.stopPropagation()}>
            <h2 id="delete-account-title">¿Borrar tu cuenta de Pesito?</h2>
            <ul>
              <li>Se borran tus movimientos, categorías, presupuestos, el vínculo con WhatsApp y tus avisos.</li>
              <li>Tus pagos quedan registrados sin tus datos personales.</li>
              <li>Perdés los días de suscripción que te queden.</li>
              <li><strong>No se puede deshacer.</strong> Si querés una copia, descargá tus movimientos antes.</li>
            </ul>
            <label>
              Tu contraseña
              <input type="password" autoComplete="current-password" value={password}
                onChange={(e) => { setPassword(e.target.value); setError(null); }} disabled={deleting} required />
            </label>
            {error && <p className="form-message form-message-error" role="alert">{error}</p>}
            <div className="account-delete-actions">
              <button type="button" className="modal-btn-cancel" onClick={close} disabled={deleting}>Cancelar</button>
              <button type="submit" className="danger-button" disabled={!password || deleting}>
                {deleting ? 'Borrando…' : 'Borrar definitivamente'}
              </button>
            </div>
          </form>
        </div>
      )}
    </article>
  );
}
