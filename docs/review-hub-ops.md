# Whiteboard Review Hub — Staging Operations Runbook

## Topology

- **Host:** the existing `ltvera-staging` GCE VM (`ltvera-gce-and-bigquery`, us-central1-a, e2-standard-2, Debian 12). It also runs the LTVera-Pandas staging stack.
- **Service:** the `whiteboard-review-hub` container, run by its own Compose project (`review-hub`) from `deploy/docker-compose.staging.yml`. Its checkout lives in `/home/ltvera/review-hub/src` (`HiQS-Labs/whiteboard-fork`, branch `feat/gh1-review-hub`) and its data in the Docker volume `review-hub_review-hub-data`.
- **Network:** the container joins the LTVera-Pandas network `ltvera-pandas_default` as `review-hub:8787`. It publishes no host ports.
- **Edge:** Cloudflare, proxied, SSL mode "Full" → the LTVera-Pandas `caddy` container (`tls internal`) → `reviews-stg.ltvera.com` → `review-hub:8787`. The site block lives in LTVera-Pandas `deploy/Caddyfile.staging`; see `deploy/Caddyfile.snippet`.
  - The name is `reviews-stg`, not `reviews.staging`, because Cloudflare's universal certificate covers single-level `*.ltvera.com` only.
- **Authentication:** both are enforced by the hub itself; Caddy adds none.
  - Publisher: bearer token `REVIEW_HUB_TOKEN`.
  - Viewers: HTTP Basic Auth, `REVIEW_HUB_USER` / `REVIEW_HUB_PASSWORD`.
- **Repository access:** a share's pinned commits are fetched over HTTPS with `GITHUB_TOKEN`, a fine-grained PAT with read-only Contents on `BinoidCBD/LTVera-Pandas`. Public repositories need no token.
- **Secrets:** `/home/ltvera/review-hub/.env` (mode 0600, owner `ltvera`). The copy of record is Secret Manager `review-hub-staging-env`.

---

## 1. First install (one time)

Run these on the VM as a user with `sudo`.

1. **Back up the edge config** before changing anything:
   ```bash
   B=~/backups/$(date +%F)-pre-review-hub && mkdir -p "$B"
   sudo docker exec ltvera-pandas-caddy-1 cat /etc/caddy/Caddyfile > "$B/Caddyfile.running"
   git -C /home/ltvera/LTVera-Pandas rev-parse HEAD > "$B/ltvera-pandas-head.txt"
   ```
2. **Check out the hub:**
   ```bash
   sudo -u ltvera mkdir -p /home/ltvera/review-hub
   sudo -u ltvera git clone --branch feat/gh1-review-hub \
     https://github.com/HiQS-Labs/whiteboard-fork.git /home/ltvera/review-hub/src
   ```
3. **Write the secrets file.** The tokens are generated on the VM and never printed:
   ```bash
   sudo -u ltvera sh -c 'umask 077; {
     echo "REVIEW_HUB_ORIGIN=https://reviews-stg.ltvera.com"
     echo "REVIEW_HUB_USER=team"
     echo "REVIEW_HUB_TOKEN=$(openssl rand -hex 32)"
     echo "REVIEW_HUB_PASSWORD=$(openssl rand -base64 18)"
     echo "GITHUB_TOKEN="
   } > /home/ltvera/review-hub/.env'
   gcloud secrets create review-hub-staging-env --data-file=/home/ltvera/review-hub/.env
   ```
   Add the GitHub PAT as a new version of `review-hub-staging-env`, then sync it into `.env` (see section 4).
4. **Build and start:**
   ```bash
   cd /home/ltvera/review-hub/src
   sudo docker compose -p review-hub -f deploy/docker-compose.staging.yml up -d --build
   sudo docker exec whiteboard-review-hub node -e "fetch('http://127.0.0.1:8787/healthz').then(r=>r.text()).then(console.log)"
   ```
5. **Route the edge:**
   - Merge the `reviews-stg.ltvera.com` block into LTVera-Pandas `deploy/Caddyfile.staging`, then on the VM:
     ```bash
     sudo -u ltvera git -C /home/ltvera/LTVera-Pandas pull --ff-only
     sudo docker exec ltvera-pandas-caddy-1 caddy reload --config /etc/caddy/Caddyfile
     ```
     A graceful reload doesn't drop `app-stg` / `auth-stg` connections, and no other container restarts.
   - In Cloudflare: a proxied `A` record `reviews-stg` → the VM's IP (the same origin as `app-stg`).

## 2. Update (each new hub version)

```bash
cd /home/ltvera/review-hub/src
sudo -u ltvera git fetch origin && sudo -u ltvera git log --oneline -1 origin/feat/gh1-review-hub
git rev-parse HEAD > ~/review-hub-previous-head.txt   # rollback point
sudo -u ltvera git merge --ff-only origin/feat/gh1-review-hub
sudo docker compose -p review-hub -f deploy/docker-compose.staging.yml up -d --build
```

Then run section 3. Shares and checkouts survive the rebuild, because they live in the data volume. Once the hub merges to `main`, switch the checkout with `git switch main` and use `origin/main` above.

## 3. Verify

```bash
curl -s https://reviews-stg.ltvera.com/healthz                                         # {"status":"ok",...}
curl -s -o /dev/null -w '%{http_code}\n' https://reviews-stg.ltvera.com/               # 401
curl -s -o /dev/null -w '%{http_code}\n' -u team:<password> https://reviews-stg.ltvera.com/   # 200
curl -s -o /dev/null -w '%{http_code}\n' https://app-stg.ltvera.com/                   # unchanged
```

Then publish a share (section 5), open it and check the document, code peeks, the Diff tab and **Source tree**.

## 4. Secrets and rotation

- To read them: `gcloud secrets versions access latest --secret=review-hub-staging-env`.
- To rotate the publisher token, viewer password or GitHub PAT:
  1. Edit `/home/ltvera/review-hub/.env`.
  2. Upload it as a new version: `gcloud secrets versions add review-hub-staging-env --data-file=/home/ltvera/review-hub/.env`.
  3. Run `sudo docker compose -p review-hub -f deploy/docker-compose.staging.yml up -d`; a changed env file recreates the container.
- The GitHub PAT expires. When LTVera-Pandas shares start showing "Could not fetch the GitHub repository", rotate it first.

## 5. Publishing a share

```bash
export DEV_REVIEW_SHARE_ORIGIN="https://reviews-stg.ltvera.com"
export DEV_REVIEW_SHARE_TOKEN="<REVIEW_HUB_TOKEN from review-hub-staging-env>"
whiteboard share    # inside a checkout whose origin is a GitHub repository
```

The CLI prints `https://reviews-stg.ltvera.com/s/<share-id>#<capability>`. Viewers sign in with the team Basic Auth credentials.

## 6. Rollback

- **Hub version:**
  ```bash
  git -C /home/ltvera/review-hub/src checkout "$(cat ~/review-hub-previous-head.txt)"
  sudo docker compose -p review-hub -f deploy/docker-compose.staging.yml up -d --build
  ```
- **Hub off:** `sudo docker compose -p review-hub -f deploy/docker-compose.staging.yml down`. The data volume is kept; add `-v` only to delete all shares.
- **Edge:**
  1. Revert the Caddy block in LTVera-Pandas (or restore `$B/Caddyfile.running`).
  2. Run `git pull --ff-only` on the VM.
  3. Run `caddy reload` as in section 1.
  4. Delete the Cloudflare record.

None of these touch the LTVera app, its database or its `.env`.

## 7. Review canvas

`/s/<share-id>` serves the Whiteboard review canvas from `packages/review/app` (entry `src/hub-entry.tsx`). It's mounted against the share through the same `/reviews-api` routes the Desktop uses. Desktop-native surfaces have web fallbacks on the hub:

- inline code peeks render the pinned file as highlighted text;
- the Diff tab diffs both sides of each file in the browser;
- **Source tree** opens an in-page file browser at the pinned head, with a GitHub link.

Code peeks, Diff and Source tree need the share's repository checked out on the hub (`GITHUB_TOKEN` for private repositories) and the structural-diff binary. The image fetches the binary at build time and points `REVIEW_DIFFR_BINARY` at it.

The canvas polls `/s/<share-id>/session` until the checkout is ready, so a freshly published share shows a short loading state before its first render.
