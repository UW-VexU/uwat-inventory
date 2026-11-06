export interface Config {
  publicUrl: string;
  /** Browsers drop Secure cookies on plain HTTP, so this follows the real address. */
  secureCookies: boolean;
  devLogin: boolean;
  github: { clientId: string; clientSecret: string; org: string } | null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const isProduction = env.NODE_ENV === 'production';
  const { GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET } = env;
  const publicUrl = (env.PUBLIC_URL ?? 'http://localhost:2210').replace(/\/$/, '');
  return {
    publicUrl,
    secureCookies: publicUrl.startsWith('https://'),
    devLogin: !isProduction && env.DEV_LOGIN === '1',
    github:
      GITHUB_CLIENT_ID && GITHUB_CLIENT_SECRET
        ? { clientId: GITHUB_CLIENT_ID, clientSecret: GITHUB_CLIENT_SECRET, org: env.GITHUB_ORG ?? 'UW-VexU' }
        : null,
  };
}
