import React, { createContext, useContext, useEffect, useState } from 'react';
import { 
    ensureAuth, 
    signOut as supabaseSignOut,
    loadJwt, 
    isExpired,
    authClient
} from '@/lib/auth';
import type { AuthChangeEvent, Session } from '@supabase/auth-js';

type AuthCtx = {
  isAuthenticated: boolean | null;   // null = still checking
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthCtx | undefined>(undefined);

export const AuthProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [isAuthenticated, setAuth] = useState<boolean | null>(null);

  /* ── watch Supabase session ───────────────────────────────────────── */
  useEffect(() => {
    // initial load
    authClient.getSession().then(({ data }: { data: { session: Session | null } }) => setAuth(!!data.session));

    // live updates
    const { data: sub } = authClient.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      setAuth(!!session);
    });

    // Listen for explicit success message from background script after OAuth
    const handler = (msg: any) => {
      if (msg.type === 'AUTH_SUCCESS') {
        setAuth(true);
      }
    };
    chrome.runtime.onMessage.addListener(handler);

    return () => {
      chrome.runtime.onMessage.removeListener(handler);
      if (sub?.subscription) {
        sub.subscription.unsubscribe();
      }
    };
  }, []);
  /* ── restore cached JWT on first paint ─────────────────────────────── */
  useEffect(() => {
    (async () => {
    const jwt = await loadJwt();
    if (jwt && !isExpired(jwt)) {
        // hydrate the in-memory Supabase client so onAuthStateChange
        // fires like a normal interactive login
        await authClient.setSession({
        access_token: jwt,
        token_type: "bearer",
        expires_in: 3600,
        refresh_token: "",
        user: {} as any,
        });
        setAuth(true);
    }
    })();
    }, []);
  

  /* ── public api ───────────────────────────────────────────────────── */
  const signIn = async () => {
    try {
      const token = await ensureAuth();
      // 1. hand the token to Supabase so SIGNED_IN is emitted
      await authClient.setSession({
        access_token: token,
        refresh_token: ""
      });
      // 2. or (even simpler) update React state directly
      setAuth(true);
    } catch (err) {
      console.error("Sign in failed:", err);
      chrome.notifications.create({
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icon/48.png'),
        title: 'Sign-in failed',
        message: String(err)
      });
    }
  };

  const signOut = async () => {
    await supabaseSignOut();
    setAuth(false); // Update state immediately for better UX
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}; 