# Personal instance: courses.jay3332.tech

This branch (`scottylabs` in the Courseweave repository) is ScottyLabs' CMU Courses, from the `courseweave` branch of
<https://git.cmu.dev/scottylabs/courses>, with what a personal instance needs on top. ScottyLabs-specific deployment
(Kennel, Keycloak) stays upstream; changes that aren't specific to this instance go upstream first and are merged in
with `git fetch scottylabs && git merge scottylabs/courseweave`.

## What differs from upstream

- Sign-in uses Google (`OIDC_ISSUER`), with the same OAuth client as Courseweave; the server admits verified CMU
  emails only. The session keeps the verified member, since Google's ID tokens expire after an hour.
- Syllabi come from Courseweave's R2 bucket through R2's S3 API, at the bucket's root (`SYLLABI_PREFIX=`).
- The server listens on `127.0.0.1` (`HOST`), reached only through the Cloudflare Tunnel.
- The footer says it's an unofficial instance and links this repository.
- Accounts carried over from Courseweave wait under their email until that member first signs in (below).

## How it runs

On the server (`ssh adapt`), everything lives in `~/courses`, run by a systemd user service:

| Path | What |
| --- | --- |
| `bin/courses-web-api` | The web API, built for x86-64 Linux |
| `site/` | The built website, served by the API |
| `catalog/catalog.sqlite` | The catalog, built with `courses-index build` |
| `data/users.sqlite` | Accounts, schedules, plans, sessions |
| `backups/` | Nightly copies of `data/users.sqlite`, the latest 14 (`courses-backup.timer`) |
| `courses.env` | Settings (from this folder) |
| `secrets.env` | Secrets, only on the server (`chmod 600`) |

The API listens on `127.0.0.1:8130`; the Cloudflare Tunnel publishes it as `https://courses.jay3332.tech`.

## Deploying

```sh
deploy/build.sh                                   # needs Docker and Deno
CATALOG=path/to/catalog.sqlite deploy/deploy.sh   # copies, then restarts the service
```

Logs: `ssh adapt journalctl --user -u courses -f`.

## One-time setup

1. On the server, keep user services running after logging out: `sudo loginctl enable-linger jay3332`.
2. In Cloudflare Zero Trust, on the server's tunnel, add the public hostname `courses.jay3332.tech` with the service
   `http://127.0.0.1:8130`.
3. In the GCP console, add `https://courses.jay3332.tech/auth/callback` to the OAuth client's authorized redirect URIs.
4. In Cloudflare R2, create an API token with read access to `courseweave-syllabi`.
5. On the server, fill in `~/courses/secrets.env` (the OAuth client secret and the R2 token's key ID and secret), then
   `systemctl --user restart courses`.

## Accounts from Courseweave

Courseweave knew accounts by email and never kept Google's subject, the owner key here. So its accounts are staged
under their email in `account_imports`, already in this app's record formats, and each moves to its owner the first
time they sign in (`src/imports.rs`). Members who already used this instance were skipped, and anyone who has records
here by the time they sign in keeps them; their staged copy is left alone.

```sh
npx wrangler d1 execute courseweave --remote --json \
  --command "SELECT u.email AS email, d.key AS key, d.data AS data FROM docs d JOIN users u ON u.id = d.user_id" > export.json
python3 deploy/import-courseweave.py convert export.json path/to/catalog.sqlite staged.json
scp staged.json adapt:courses/staged.json
ssh adapt 'cd ~/courses && systemctl --user start courses-backup && python3 - stage staged.json data/users.sqlite; rm staged.json' \
  < deploy/import-courseweave.py
```

Both files hold personal data: keep them private (`umask 077`) and delete them afterwards. Schedules keep only courses
the catalog offers in their semester, and sections it lists; the rest is left out and counted.
