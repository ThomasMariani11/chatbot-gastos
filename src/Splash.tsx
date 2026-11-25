import { useState } from 'react';

// Pantalla de inicio. El CSS vive en index.html (se pinta antes de que cargue el bundle);
// este marcado debe coincidir con el de #root allí (lo verifica tests/splash-component.test.ts).
export function Splash() {
  // Continúa la barra desde donde iba la de index.html en lugar de volver a cero.
  const [barDelay] = useState(() => `-${Math.round(performance.now())}ms`);
  return (
    <div className="pesito-splash" role="status">
      <svg className="pesito-splash__pig" viewBox="0 0 170 170" aria-hidden="true" focusable="false">
        <defs>
          <clipPath id="pesito-splash-above"><rect width="170" height="54" /></clipPath>
        </defs>
        <ellipse cx="88" cy="148" rx="50" ry="6" fill="#0a5238" opacity=".25" />
        <path d="M106,52 C118,38 138,34 142,40 C144,54 136,68 126,72 Z" fill="#1b8d60" />
        <rect x="60" y="118" width="18" height="24" rx="7" fill="#1b8d60" />
        <rect x="100" y="118" width="18" height="24" rx="7" fill="#1b8d60" />
        <circle cx="88" cy="90" r="46" fill="#45c992" />
        <ellipse cx="44" cy="98" rx="15" ry="14" fill="#1b8d60" />
        <ellipse cx="39" cy="98" rx="2.6" ry="4.2" fill="#062f20" />
        <ellipse cx="49" cy="98" rx="2.6" ry="4.2" fill="#062f20" />
        <path d="M62,80 Q68,73 74,80" stroke="#0a5238" strokeWidth="3.5" fill="none" strokeLinecap="round" />
        <g clipPath="url(#pesito-splash-above)">
          <g className="pesito-splash__coin">
            <circle cx="89" cy="24" r="14" fill="#ffcc45" />
            <circle cx="89" cy="24" r="9" fill="none" stroke="#c4860a" strokeWidth="2" />
          </g>
        </g>
        <rect className="pesito-splash__slot" x="75" y="50" width="28" height="7" rx="3.5" fill="#0a5238" />
      </svg>
      <span className="pesito-splash__name">Pesito</span>
      <span className="pesito-splash__track">
        <span className="pesito-splash__bar" style={{ animationDelay: barDelay }} />
      </span>
      <span className="pesito-splash__label">Abriendo Pesito…</span>
    </div>
  );
}
