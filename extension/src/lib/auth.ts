/**
 * auth.ts – Supabase auth helper for the workflow-use Chrome extension
 * --------------------------------------------------
 * • Tries to reuse a cached JWT from chrome.storage.sync
 * • Refreshes silently if token is ~expiring
 * • Falls back to interactive Google OAuth (chrome.identity) on first run
 * --------------------------------------------------
 */

import { createClient } from '@supabase/supabase-js';
import { decode } from 'js-base64';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: false },      // we'll manage storage ourselves
});

// Polyfill for atob
globalThis.atob = decode;

/* ---------- private helpers ---------- */

/** returns when the JWT expires, in seconds since epoch */
function getExpiry(jwt: string) {
  try {
    const body = jwt.split('.')[1];
    const decoded = JSON.parse(atob(body));
    return decoded.exp as number;
  } catch {
    return 0;
  }
}

/** returns true if the JWT will expire in the next 30 seconds */
function isExpiringSoon(jwt: string) {
  const expiry = getExpiry(jwt);
  const now = Date.now() / 1000;
  return expiry - now < 30;
}

const STORAGE_KEY = 'workflow-use:jwt';

async function saveJwt(jwt: string) {
  await chrome.storage.local.set({ [STORAGE_KEY]: jwt });
}

async function loadJwt() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  return data[STORAGE_KEY] as (string | undefined);
}

/* ---------- public API ---------- */

/** Ensures we have a valid JWT and returns it. Opens Google OAuth if needed. */
export async function ensureAuth(): Promise<string> {
  // 1) try cached
  let jwt = await loadJwt();
  if (jwt && !isExpiringSoon(jwt)) return jwt;

  // 2) attempt silent refresh (if we have a refresh token in memory)
  const { data: refresh } = await supabase.auth.refreshSession();
  if (refresh.session?.access_token) {
    jwt = refresh.session.access_token;
    await saveJwt(jwt);
    return jwt;
  }

  // 3) interactive Google sign-in
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: chrome.identity.getRedirectURL() },
  });
  if (error || !data?.url) throw error ?? new Error('OAuth URL missing');

  const redirectUri = await chrome.identity.launchWebAuthFlow({
    url: data.url,
    interactive: true,
  });

  if (!redirectUri) throw new Error('OAuth flow failed: No redirect URI');

  // Supabase appends the session to the URL hash
  const fragments = new URLSearchParams(redirectUri.split('#')[1]);
  const newJwt = fragments.get('access_token');
  if (!newJwt) throw new Error('access_token not returned from OAuth flow');

  // Store & return
  await saveJwt(newJwt);
  return newJwt;
}

/** Sign the user out (optional button in side-panel) */
export async function signOut() {
  await supabase.auth.signOut();
  await chrome.storage.local.remove(STORAGE_KEY);
} 