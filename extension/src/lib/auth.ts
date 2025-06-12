/**
 * auth.ts – Supabase auth helper for the workflow-use Chrome extension
 * --------------------------------------------------
 * This is the **single** source‑of‑truth auth helper used by background, popup &
 * side‑panel.  It adds a pile of `console.info` statements so you can see the
 * state‑machine step‑by‑step inside DevTools (☰ ▸ Extensions ▸ "service‑worker"
 * or the side‑panel frame).
 * --------------------------------------------------
 */

import { AuthClient } from "@supabase/auth-js";

// ────────────────────────────────────────────────────────────────────────────────
// Single source‑of‑truth auth helper used by background, popup & side‑panel.
// Adds *very* chatty console output so you can follow every branch.                
// ────────────────────────────────────────────────────────────────────────────────

const SUPABASE_URL = "https://dmgtsseqqsiyuuzhdxnn.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRtZ3Rzc2VxcXNpeXV1emhkeG5uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDk3MzE4ODIsImV4cCI6MjA2NTMwNzg4Mn0.e5bQXtdRsPY31fEp2xextWC4QKYUcAvj77hEDVZHuZw";
const JWT_KEY = "workflow‑use:jwt";

// Slimmer bundle than the full Supabase client
const supabase = new AuthClient({
  url: `${SUPABASE_URL}/auth/v1`,
  headers: { apikey: SUPABASE_ANON_KEY },
  persistSession: false,
});

// ───────────────────────────────── helpers ─────────────────────────────────────

function decodeExp(jwt: string): number {
  try {
    const payload = JSON.parse(atob(jwt.split(".")[1]));
    return payload.exp ?? 0;
  } catch {
    return 0;
  }
}

export function isExpired(jwt: string): boolean {
  const exp = decodeExp(jwt);
  const now = Date.now() / 1000;
  return exp - now < 30; // treat "<30 s left" as already expired
}

async function storeJwt(token: string) {
  await chrome.storage.local.set({ [JWT_KEY]: token });
}
export async function loadJwt(): Promise<string | undefined> {
  const obj = await chrome.storage.local.get(JWT_KEY);
  return obj[JWT_KEY];
}

// helper so we can pick up chrome.runtime.lastError *reliably*
function launchWebAuth(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow(
      { url, interactive: true },
      (redirectUri) => {
        const err = chrome.runtime.lastError;
        if (err) {
          console.error("[auth] launchWebAuthFlow lastError →", err.message);
          reject(err);
          return;
        }
        if (!redirectUri) {
          reject(new Error("launchWebAuthFlow returned empty redirect URI"));
          return;
        }
        resolve(redirectUri);
      }
    );
  });
}

// ─────────────────────────────── ensureAuth() ──────────────────────────────────

export async function ensureAuth(): Promise<string> {
  const started = Date.now();
  console.info("[auth] ensureAuth() • start ─────────────────────────");

  // 1. reuse stored token ──────────────────────────────────────────────
  let token = await loadJwt();
  console.info("[auth] stored JWT:", token?.slice(0, 8), "expired?", token ? isExpired(token) : "n/a");
  if (token && !isExpired(token)) {
    console.info("[auth] ✓ using stored token (still valid)");
    console.info(`[auth] done in ${Date.now() - started} ms`);
    return token;
  }

  // 2. silent refresh ─────────────────────────────────────────────────
  try {
    console.info("[auth] attempting refreshSession() …");
    const { data, error } = await supabase.refreshSession();
    console.info("[auth] refreshSession() result:", { hasSession: !!data?.session, error });

    const refreshed = data?.session?.access_token;
    if (refreshed) {
      console.info("[auth] ✓ got new token from refresh");
      await storeJwt(refreshed);
      console.info(`[auth] done in ${Date.now() - started} ms`);
      return refreshed;
    }
    if (error) console.warn("[auth] refreshSession() error", error);
  } catch (err) {
    console.error("[auth] refreshSession() threw", err);
  }

  // 3. interactive OAuth ──────────────────────────────────────────────
  const redirectUrl = chrome.identity.getRedirectURL();
  console.info("[auth] starting OAuth flow – redirectURL:", redirectUrl);

  let oauthUrl: string;
  try {
    const { data: oauth, error: oauthErr } = await supabase.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: redirectUrl,
        skipBrowserRedirect: true,
      },
    });
    console.info("[auth] signInWithOAuth response:", { oauthErr, hasUrl: !!oauth?.url });
    if (oauthErr || !oauth?.url) throw oauthErr ?? new Error("OAuth URL missing");
    oauthUrl = oauth.url;
  } catch (e) {
    console.error("[auth] signInWithOAuth threw", e);
    throw e;
  }

  console.info("[auth] launching chrome.identity.launchWebAuthFlow …");
  let finalRedirect: string;
  try {
    console.info("[auth] opening URL →", oauthUrl);
    finalRedirect = await launchWebAuth(oauthUrl);
  } catch (e) {
    console.error("[auth] launchWebAuthFlow threw/lastError", e);
    throw e;
  }
  console.info("[auth] launchWebAuthFlow returned:", finalRedirect?.slice(0, 120));

  const qs = finalRedirect.split("#")[1] ?? "";
  const accessToken = new URLSearchParams(qs).get("access_token");
  console.info("[auth] extracted access_token:", accessToken?.slice(0, 8));
  if (!accessToken) throw new Error("access_token not returned from OAuth flow");

  await storeJwt(accessToken);
  console.info("[auth] token stored – broadcasting AUTH_SUCCESS …");
  chrome.runtime.sendMessage({ type: "AUTH_SUCCESS" }).catch(() => {});

  console.info(`[auth] ensureAuth() • done in ${Date.now() - started} ms`);

  // 4. token is stored at chrome.storage.
  return accessToken;
}

export function signOut() {
  console.info("[auth] signOut() called – clearing storage");
  return chrome.storage.local.remove(JWT_KEY);
}

export const authClient = supabase;   // 👈 new — share the live instance