interface Props {
  isOpen: boolean;
  onClose: () => void;
  isIos: boolean;
}

export function InstallAppModal({ isOpen, onClose, isIos }: Props) {
  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={onClose} style={{ zIndex: 9999 }}>
      <div
        className="modal-content"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: '440px',
          width: '90%',
          padding: '24px',
          borderRadius: '16px',
          background: '#ffffff',
          boxShadow: '0 20px 40px rgba(0, 0, 0, 0.2)',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: '42px', marginBottom: '8px' }}>📲</div>
        <h2 style={{ fontSize: '20px', fontWeight: 800, margin: '0 0 8px', color: '#0f172a' }}>
          Instalar Pesito en tu celular
        </h2>
        <p style={{ fontSize: '14px', color: '#64748b', margin: '0 0 20px', lineHeight: 1.5 }}>
          Tené la app en tu pantalla de inicio para entrar más rápido y sin abrir el navegador.
        </p>

        {isIos ? (
          <div
            style={{
              textAlign: 'left',
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '12px',
              padding: '16px',
              fontSize: '14px',
              color: '#334155',
              lineHeight: 1.6,
            }}
          >
            <p style={{ margin: '0 0 12px', fontWeight: 700, color: '#0f172a' }}>
              En iPhone / iPad (Safari):
            </p>
            <ol style={{ margin: 0, paddingLeft: '20px' }}>
              <li style={{ marginBottom: '8px' }}>
                Tocá el botón <strong>Compartir</strong> en la barra inferior de Safari{' '}
                <span style={{ fontSize: '16px', display: 'inline-block', verticalAlign: 'middle' }}>
                  (el ícono de la cajita con la flecha ⎋)
                </span>.
              </li>
              <li style={{ marginBottom: '8px' }}>
                Deslizá hacia abajo y seleccioná{' '}
                <strong>"Agregar a pantalla de inicio"</strong>{' '}
                <span style={{ fontSize: '16px' }}>➕</span>.
              </li>
              <li>
                Tocá <strong>"Agregar"</strong> arriba a la derecha. ¡Listo!
              </li>
            </ol>
          </div>
        ) : (
          <div
            style={{
              textAlign: 'left',
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '12px',
              padding: '16px',
              fontSize: '14px',
              color: '#334155',
              lineHeight: 1.6,
            }}
          >
            <p style={{ margin: '0 0 12px', fontWeight: 700, color: '#0f172a' }}>
              En Android o Chrome:
            </p>
            <ol style={{ margin: 0, paddingLeft: '20px' }}>
              <li style={{ marginBottom: '8px' }}>
                Tocá los <strong>tres puntos ⋮</strong> arriba a la derecha en el navegador.
              </li>
              <li style={{ marginBottom: '8px' }}>
                Seleccioná <strong>"Instalar aplicación"</strong> o{' '}
                <strong>"Agregar a la pantalla principal"</strong>.
              </li>
              <li>Confirmá tocando <strong>"Instalar"</strong>.</li>
            </ol>
          </div>
        )}

        <div style={{ marginTop: '20px' }}>
          <button
            type="button"
            className="primary-button"
            onClick={onClose}
            style={{ width: '100%', padding: '12px', borderRadius: '10px' }}
          >
            Entendido 👍
          </button>
        </div>
      </div>
    </div>
  );
}
