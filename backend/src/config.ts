export interface Config {
  isProduction: boolean;
  publicUrl: string;
  devLogin: boolean;
  github: { clientId: string; clientSecret: string; org: string } | null;
  digikey: { clientId: string; clientSecret: string } | null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const isProduction = env.NODE_ENV === 'production';
  const { GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, DIGIKEY_CLIENT_ID, DIGIKEY_CLIENT_SECRET } = env;
  return {
    isProduction,
    publicUrl: (env.PUBLIC_URL ?? 'http://localhost:2210').replace(/\/$/, ''),
    devLogin: !isProduction && env.DEV_LOGIN === '1',
    github:
      GITHUB_CLIENT_ID && GITHUB_CLIENT_SECRET
        ? { clientId: GITHUB_CLIENT_ID, clientSecret: GITHUB_CLIENT_SECRET, org: env.GITHUB_ORG ?? 'UW-VexU' }
        : null,
    digikey:
      DIGIKEY_CLIENT_ID && DIGIKEY_CLIENT_SECRET
        ? { clientId: DIGIKEY_CLIENT_ID, clientSecret: DIGIKEY_CLIENT_SECRET }
        : null,
  };
}
