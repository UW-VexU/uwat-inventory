import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, connect } from './api';

interface Session {
  ready: boolean;
  signedIn: boolean;
  server: string;
  signIn: (server: string, name: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const Context = createContext<Session | null>(null);

const defaultServer = process.env.EXPO_PUBLIC_API_URL ?? '';

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [server, setServer] = useState(defaultServer);

  useEffect(() => {
    void (async () => {
      const savedServer = (await SecureStore.getItemAsync('server')) ?? defaultServer;
      const token = await SecureStore.getItemAsync('token');
      setServer(savedServer);
      connect(savedServer, token);
      setSignedIn(Boolean(token));
      setReady(true);
    })();
  }, []);

  const signIn = useCallback(async (nextServer: string, name: string) => {
    connect(nextServer, null);
    const methods = await api<{ dev: boolean }>('/api/auth/config');
    if (!methods.dev) throw new Error("This server uses GitHub sign-in, which the app doesn't have yet.");

    const { token } = await api<{ token: string }>('/api/auth/dev', { method: 'POST', body: { login: name } });
    await SecureStore.setItemAsync('server', nextServer);
    await SecureStore.setItemAsync('token', token);
    connect(nextServer, token);
    setServer(nextServer);
    setSignedIn(true);
  }, []);

  const signOut = useCallback(async () => {
    // Don't wait on the server: when it's unreachable, signing out is how you change it.
    void api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    await SecureStore.deleteItemAsync('token');
    connect(server, null);
    setSignedIn(false);
  }, [server]);

  const value = useMemo(
    () => ({ ready, signedIn, server, signIn, signOut }),
    [ready, signedIn, server, signIn, signOut],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useSession(): Session {
  const value = useContext(Context);
  if (!value) throw new Error('useSession needs a SessionProvider');
  return value;
}
