import { NextRequest, NextResponse } from 'next/server';
import { createServiceSupabase } from '../../../lib/server/supabase';

export const runtime = 'edge';

export async function POST(request: NextRequest) {
  const bearer = request.headers.get('authorization')?.replace(/^Bearer /, '');
  if (!bearer) return NextResponse.json({ error: 'Sesión requerida.' }, { status: 401 });
  const supabase = createServiceSupabase();
  const { data: auth, error } = await supabase.auth.getUser(bearer);
  if (error || !auth.user) return NextResponse.json({ error: 'Sesión inválida.' }, { status: 401 });
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code));
  const hash = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await supabase.from('whatsapp_links').update({ link_code_hash: hash, link_code_expires_at: expires, status: 'pending' }).eq('user_id', auth.user.id);
  return NextResponse.json({ code, expiresAt: expires });
}
