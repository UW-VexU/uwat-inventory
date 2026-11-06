'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Icon } from '@/components/Icon';
import { api, errorMessage } from '@/lib/api';

const ERRORS: Record<string, string> = {
  not_member: "That GitHub account isn't in the UW-VexU org. Ask a lead to add you, then try again.",
  denied: 'GitHub sign-in was cancelled.',
  expired: 'That sign-in took too long. Try again.',
  github: "GitHub didn't respond properly. Try again in a moment.",
};

function LoginCard() {
  const params = useSearchParams();
  const [methods, setMethods] = useState<{ github: boolean; dev: boolean } | null>(null);
  const [devName, setDevName] = useState('connor');
  const [problem, setProblem] = useState<string | null>(null);
  const errorCode = params.get('error');

  useEffect(() => {
    api<{ github: boolean; dev: boolean }>('/api/auth/config')
      .then(setMethods)
      .catch((error: unknown) => setProblem(errorMessage(error)));
  }, []);

  const devSignIn = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await api('/api/auth/dev', { method: 'POST', body: { login: devName } });
      window.location.assign('/');
    } catch (error) {
      setProblem(errorMessage(error));
    }
  };

  const message = problem ?? (errorCode ? (ERRORS[errorCode] ?? 'Sign-in failed. Try again.') : null);

  return (
    <div className="login-card">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/uwat-logo-white.svg" alt="UWAT" width={232} height={54} />
      <p className="login-team">VEXU Competitive Robotics</p>
      <h1>Parts inventory</h1>

      {message ? (
        <p className="form-error" role="alert">
          {message}
        </p>
      ) : null}

      {methods?.github ? (
        <a className="button button-primary button-wide" href="/api/auth/github">
          <Icon name="github" />
          Sign in with GitHub
        </a>
      ) : null}

      {methods && !methods.github && !methods.dev ? (
        <p className="form-error">Sign-in isn't set up on this server yet. See DEPLOY.md.</p>
      ) : null}

      {methods?.dev ? (
        <form className="login-dev" onSubmit={devSignIn}>
          <label className="field">
            <span>Dev sign-in</span>
            <input value={devName} onChange={(event) => setDevName(event.target.value)} />
          </label>
          <button type="submit" className="button button-wide">
            Continue
          </button>
        </form>
      ) : null}
    </div>
  );
}

export default function LoginPage() {
  return (
    <main className="login">
      <Suspense>
        <LoginCard />
      </Suspense>
    </main>
  );
}
