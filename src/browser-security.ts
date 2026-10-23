// GitHub Pages sirve HTML estático; la CSP se incorpora al artefacto del build.
export const SECURITY_POLICY_MARKER = '<!-- PESITO_BROWSER_SECURITY -->';

export function browserContentSecurityPolicy(supabaseUrl: string): string {
  const backend = new URL(supabaseUrl);
  const local =
    backend.protocol === 'http:' &&
    ['127.0.0.1', 'localhost'].includes(backend.hostname) &&
    Boolean(backend.port);
  if (
    (!local && backend.protocol !== 'https:') ||
    backend.username ||
    backend.password ||
    backend.search ||
    backend.hash ||
    !['', '/'].includes(backend.pathname)
  ) {
    throw new Error('Origen de conexión inválido para la política del navegador.');
  }
  const realtime = new URL(backend.origin);
  realtime.protocol = backend.protocol === 'https:' ? 'wss:' : 'ws:';
  return [
    "default-src 'none'",
    "script-src 'self'",
    "script-src-attr 'none'",
    // React y Recharts usan estilos dinámicos; esta excepción no habilita scripts.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self' " + backend.origin + ' ' + realtime.origin,
    "manifest-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-src 'none'",
    "media-src 'none'",
  ].join('; ');
}

export function injectBrowserSecurity(html: string, supabaseUrl: string): string {
  const marker = html.indexOf(SECURITY_POLICY_MARKER);
  const charset = /<meta\s+charset=["']utf-8["']\s*\/?[>]/i.exec(html);
  const headStart = /<head(?:\s[^>]*)?>/i.exec(html)?.index ?? -1;
  const headEnd = /<\/head\s*>/i.exec(html)?.index ?? -1;
  const firstResource = /<(?:script|link|style)\b/i.exec(html)?.index ?? html.length;
  if (
    !charset ||
    headStart < 0 ||
    charset.index < headStart ||
    marker >= headEnd ||
    marker < charset.index + charset[0].length ||
    marker > firstResource ||
    html.indexOf(SECURITY_POLICY_MARKER, marker + 1) !== -1 ||
    /http-equiv=["']Content-Security-Policy["']/i.test(html)
  ) {
    throw new Error('La política debe aparecer una sola vez, después de charset y antes de los recursos.');
  }
  const policy = browserContentSecurityPolicy(supabaseUrl);
  return html.replace(
    SECURITY_POLICY_MARKER,
    () => '<meta http-equiv="Content-Security-Policy" content="' + policy + '" />',
  );
}
