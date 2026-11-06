# Deploying

The site, API and Postgres run together in Docker Compose. Caddy sends `/api/*` to the API and everything else to the site, so only one port is exposed. The default is 2210, which doesn't clash with the Workspace tool on 2200.

## 1. Create the GitHub OAuth app

Create it under the **UW-VexU** org: Settings > Developer settings > OAuth Apps > New OAuth App.

| Field | Value |
| --- | --- |
| Homepage URL | Your `PUBLIC_URL` |
| Authorization callback URL | `<PUBLIC_URL>/api/auth/github/callback` |

Generate a client secret and keep it for the next step.

Only active members of the org can sign in. If you make the app under a personal account instead, and the org restricts third-party apps, an org owner has to approve it. Until then, everyone gets told they aren't in the org.

## 2. Configure

```bash
cp .env.example .env
```

Fill in `PUBLIC_URL`, `POSTGRES_PASSWORD`, `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`.

`PUBLIC_URL` must be the exact address people open, with no trailing slash. Sign-in redirects and cross-site protection both depend on it.

## 3. Start

```bash
docker compose up -d --build
```

Migrations run when the API starts. Then point your domain or tunnel at `WEB_PORT`.

For a Cloudflare Tunnel, set `CLOUDFLARE_TUNNEL_TOKEN` and run:

```bash
docker compose -f docker-compose.yml -f docker-compose.tunnel.yml up -d --build
```

## 4. Load your parts

Sign in, add your boxes under **Boxes**, print the labels, then use **Import** or **Add bag**.

## Updating

```bash
git pull
docker compose up -d --build
```

Data stays in the `pgdata` volume.

## Backups

```bash
docker compose exec -T postgres pg_dump -U uwat uwat_inventory | gzip > ~/backups/uwat-inventory-$(date +%F).sql.gz
```

To restore into a fresh database:

```bash
gunzip -c backup.sql.gz | docker compose exec -T postgres psql -U uwat uwat_inventory
```

You can also download a plain CSV of the inventory from **Activity**.
