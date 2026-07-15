# AWS Deployment Runbook — CineSense (EC2 Free Tier)

**Owner:** Shreyansh Jain ([@shreyansh0714](https://github.com/shreyansh0714))
**Status:** ✅ **DEPLOYED** and live — see the [Deployment record](#12-deployment-record-filled-in-after-deploying). This document is both the runbook we followed and the record of what we actually did.

> **Why EC2 and not App Runner:** the first version of this runbook targeted AWS
> App Runner. It turns out App Runner has **no free tier** — the smallest
> instance runs roughly $2.5–3/month while active. Our course brief requires a
> **free** deployment, so we switched to **EC2**, which is covered by our AWS
> account's free credits (see §1). This pivot — and why — belongs in the
> report's "challenges & resolutions" section.

This is the exact, copy-pasteable procedure for deploying CineSense to a free-tier
AWS EC2 instance with real HTTPS at no cost, plus the required budget alert and
an end-to-end verification checklist. Issues hit during the real deployment go
in [Troubleshooting](#8-troubleshooting--issues-hit) — that feeds the report.

---

## 0. Why these choices (decision rationale)

Course rule: every teammate must be able to explain every decision. Here they are.

| Decision | Why |
|---|---|
| **EC2** (not App Runner/ECS/Lambda) | The only mainstream AWS compute option that is genuinely **free** for a small always-on web app on our account's free plan. |
| **`t3.micro`** | The free-tier-eligible instance size in our region (eu-north-1). Older `t2.micro` isn't offered in Stockholm; whichever shows "Free tier eligible" in your region's launch wizard is the one to pick. Smallest size = slowest to burn credits. |
| **Amazon Linux 2023 AMI** | Free-tier eligible, comes with `dnf`, minimal setup to get Docker running. |
| **One Elastic IP** | Gives us a stable public IP that doesn't change if the instance reboots — important because our public URL and its HTTPS certificate are tied to that IP. (Caution in §10: a public IPv4 now carries a small hourly cost, covered by our credits while the instance runs; releasing a *dangling* IP after stopping the instance avoids waste.) |
| **Caddy reverse proxy (run as a Docker container) + a [nip.io](https://nip.io) hostname** | We need a public **HTTPS** URL but don't own a domain. `nip.io` is a free DNS trick: a hostname like `13-60-161-144.nip.io` automatically resolves to IP `13.60.161.144` — a real, resolvable hostname, so Caddy can get a **real, free** Let's Encrypt certificate for it. We run Caddy as a second Docker container (reusing the Docker we already installed) rather than as a system package — fewer moving parts, and it auto-manages the certificate. Zero cost, zero domain purchase. |
| **Plain `docker run`, manual redeploy** | One container, no orchestration needed; `git pull && docker build` on the instance is enough for a project this size. |
| **Budget alert kept** | Safety net — if credits run out, an instance type changes by mistake, or an Elastic IP gets left dangling on a stopped instance, this catches it before it becomes real money. |

> **Our account uses AWS's newer "free plan" credit model** (not the classic
> "12 months / 750 hours free" list): the console showed **$120 in free credits
> valid ~6 months**, and "costs in your free plan account are covered by
> credits." So the small EC2 + IPv4 costs are absorbed by credits → **$0 out of
> pocket** for the project's duration. Check **Billing → Free Tier / Credits**
> in your own console to see exactly what applies to your account.

---

## 1. Prerequisites (one-time, on your machine)

```powershell
docker --version
aws --version
aws sts get-caller-identity        # must print your Account ID
```

Also confirm free-tier eligibility yourself: AWS Console → **Billing and Cost
Management** → **Free Tier** (or **Credits**) — note what it says, screenshot
it for the report (evidence this was a deliberate, verified choice, not a guess).

You'll also want an SSH client, which macOS/Linux have built in (`ssh`) and
Windows 10+ has too (via PowerShell or Git Bash).

---

## 2. Launch the EC2 instance

AWS Console → set your region → **EC2** → **Launch instance**:

1. **Name:** `cinesense`
2. **AMI:** Amazon Linux 2023 (should be marked "Free tier eligible")
3. **Instance type:** `t2.micro` — if it's not offered as free-tier eligible in
   your region, use `t3.micro` instead (whichever is marked free-tier eligible).
4. **Key pair:** Create a new key pair, name it `cinesense-key`, download the
   `.pem` file and keep it somewhere safe — you cannot re-download it.
5. **Network settings → Edit:**
   - Allow SSH (port 22) from **My IP** only (not "Anywhere" — keep this locked to you)
   - Allow HTTP (port 80) from **Anywhere** (needed for the HTTPS certificate handshake)
   - Allow HTTPS (port 443) from **Anywhere**
6. **Storage:** leave the default (8 GiB gp3 is within the free 30 GiB/month allowance).
7. **Launch instance.**

📸 Screenshot: the instance in *Running* state, showing "Free tier eligible" on the instance type.

## 3. Allocate a stable public IP (Elastic IP)

1. EC2 Console → **Elastic IPs** → **Allocate Elastic IP address** → Allocate.
2. Select it → **Actions** → **Associate Elastic IP address** → choose the
   `cinesense` instance → Associate.
3. Note the IP address, e.g. `3.101.45.67` — you'll need it below.

> This IP is free *only while attached to a running instance*. See §7 for what
> happens if you stop the instance.

## 4. Connect and install Docker

From your **own machine's** terminal. The key downloaded to `~/Downloads`, but
macOS blocks changing file permissions inside Downloads ("Operation not
permitted") — move it to your home folder first (via Finder if the terminal is
also blocked from Downloads), then lock it down:

```sh
# in ~ (home), after moving cinesense-key.pem here
chmod 400 cinesense-key.pem
ssh -i cinesense-key.pem ec2-user@<ELASTIC_IP>    # type "yes" at the first-time prompt
```

Then, **on the instance**, install Docker + Git:

```sh
sudo dnf install -y docker git
sudo systemctl enable --now docker
sudo usermod -aG docker ec2-user
exit
# log back in so the docker group membership takes effect
ssh -i cinesense-key.pem ec2-user@<ELASTIC_IP>
docker --version   # confirm it works without sudo
```

## 5. Get the code and build the image, on the instance

```sh
git clone https://github.com/shreyansh0714/CineSense.git
cd CineSense
docker build -t cinesense .
```

## 6. Run the app container

```sh
docker run -d --name cinesense --restart unless-stopped \
  -p 127.0.0.1:8080:8080 \
  -e GEMINI_API_KEY=your-real-key-here \
  cinesense
```

Bound to `127.0.0.1` only — the app is not exposed to the internet directly;
Caddy (next step) is the public-facing side and terminates HTTPS. This is also
where the "no keys in code" requirement lives in production: the key exists
only in this `docker run` command on the server, never in the repo.

## 7. Free automatic HTTPS with Caddy + nip.io

Take your Elastic IP and replace the dots with dashes, then append `.nip.io`.
Example: `13.60.161.144` → `13-60-161-144.nip.io`. This hostname resolves back
to your IP automatically — no DNS setup or domain purchase needed.

We run **Caddy as a second Docker container** (simpler than installing it as a
system package on Amazon Linux — reuses the Docker we already have, and
survives reboots via `--restart unless-stopped`):

```sh
docker run -d --name caddy --restart unless-stopped \
  --network host \
  -v caddy_data:/data \
  caddy:2 caddy reverse-proxy \
  --from 13-60-161-144.nip.io --to localhost:8080
# replace 13-60-161-144 with YOUR elastic IP, dashes for dots
```

Why it works:
- `--network host` lets the Caddy container bind ports 80/443 on the host and
  reach the app at `localhost:8080` (where §6 bound it).
- `caddy reverse-proxy --from <host> --to localhost:8080` auto-provisions a real
  Let's Encrypt certificate (via the TLS-ALPN-01 challenge over port 443) and
  proxies HTTPS traffic to the app — no config file needed.
- `-v caddy_data:/data` persists the certificate across restarts (avoids
  re-requesting it and hitting rate limits).

Confirm the certificate was issued:

```sh
docker logs caddy    # look for: "certificate obtained successfully"
```

Your public URL is now `https://13-60-161-144.nip.io` (using your own IP).

📸 Screenshots: the `docker logs caddy` "certificate obtained successfully"
line; the browser padlock on the live URL.

## 8. Verify end-to-end (the deployment isn't done until this passes)

```powershell
$URL = "https://3-101-45-67.nip.io"    # your actual nip.io URL
curl "$URL/api/health"
curl -N -X POST "$URL/api/recommend" -H "Content-Type: application/json" -d '{\"mood\":\"fried after work\",\"favorites\":[{\"title\":\"Whiplash\",\"why\":\"the obsession\"}],\"constraints\":\"under 2 hours\"}'
```

Then in a **browser**:

- [ ] Open the nip.io URL on desktop → real HTTPS padlock, no warnings
- [ ] Submit mood + 2 favorites + a constraint → reasoning streams before the pick
- [ ] Refine with "too heavy" → new pick, no repeat
- [ ] Open the same URL on your **phone** → layout works (responsive requirement)

## 9. Budget alert (required by the course brief, and a genuine safety net here)

Console → **Billing and Cost Management** → **Budgets** → **Create budget**:

1. Customize (advanced) → Cost budget
2. Monthly, **$5.00**, name `cinesense-budget`
3. Alert threshold: **80% of budgeted amount**, on **Actual**
4. Your email → Create

📸 Screenshot: the budget with its alert threshold.

## 10. Operating the instance (staying inside the free tier)

- **You do not need to stop the instance between demos.** The free tier is
  750 hours/month for one instance — a full month is ~730 hours — so leaving
  it running continuously for the whole project stays inside the limit.
- **If you do stop it anyway:** EC2 → select instance → *Instance state* →
  *Stop*. Careful — a Stopped instance's Elastic IP starts accruing a small
  hourly charge (it's only free while attached to a *running* instance). Either
  leave the instance running, or release the Elastic IP when you stop it
  (accepting that you'll get a new IP — and a new nip.io hostname — next time
  you start it and reassociate).
- **Redeploy after a code change:**
  ```sh
  ssh -i cinesense-key.pem ec2-user@<ELASTIC_IP>
  cd CineSense && git pull
  docker build -t cinesense .
  docker stop cinesense && docker rm cinesense
  docker run -d --name cinesense --restart unless-stopped -p 127.0.0.1:8080:8080 -e GEMINI_API_KEY=your-key cinesense
  ```
- **Logs:** `docker logs cinesense`
- **Teardown after grading:** EC2 → *Instance state* → *Terminate*; then
  **Elastic IPs** → select yours → *Release Elastic IP address*; then delete
  the security group if you want to fully clean up.

## 11. Troubleshooting / issues hit

| Symptom | Cause → Fix |
|---|---|
| **`chmod: ... Operation not permitted` on the `.pem` key (macOS)** | *(hit during our deploy)* macOS privacy protection blocks the terminal from modifying files inside `~/Downloads`. → Move the key to your home folder (drag it there in Finder, which isn't restricted), then `chmod 400` there. Or grant the terminal Full Disk Access in System Settings → Privacy & Security. |
| `ssh: Permission denied (publickey)` | Wrong username (`ec2-user` for Amazon Linux, not `ubuntu`/`root`) or `.pem` file permissions too open → `chmod 400` |
| Browser can't reach the nip.io URL at all | Security group missing port 80/443 from Anywhere, or Elastic IP not associated → check §2 step 5 and §3 |
| Caddy fails to get a certificate | Ports 80 and 443 must both be open (Let's Encrypt validates via TLS-ALPN-01 over 443, with HTTP→HTTPS on 80) → confirm the security-group rules; or the nip.io hostname doesn't match your actual Elastic IP (typo in the dashes) |
| App container exits immediately | Check `docker logs cinesense` — usually a missing/wrong `GEMINI_API_KEY` |
| SSE error "Server misconfiguration — is GEMINI_API_KEY set?" in the browser | Same as above — the app fails soft on a bad key by design; fix the `docker run` command and restart the container |
| Instance stopped working after a while | Check Billing → Free Tier / Credits — confirm credits remain and you haven't accidentally launched a second instance |

## 12. Deployment record (filled in after deploying)

| Field | Value |
|---|---|
| Deployed by | Shreyansh Jain |
| Date | 15 July 2026 |
| Region | Europe (Stockholm) — eu-north-1 |
| Instance type | t3.micro (free-tier eligible) |
| Instance ID | i-0a2c38bad5d2be71f |
| Elastic IP | 13.60.161.144 |
| Public URL | **https://13-60-161-144.nip.io** |
| HTTPS | Let's Encrypt via Caddy (valid padlock, no warnings) |
| Monthly cost | $0 (covered by AWS free-plan credits; $120 available, ~6 months) |
| Budget alert | $5/month, email at 80% ✅ |
| End-to-end checklist (§8) | ✅ PASS — health OK, full recommendation + reasoning streamed over the public HTTPS URL (desktop) |

---

## 13. Vibe-coding log — prompts used for this deliverable

1. **Handoff brief** — the full project-context prompt lives in
   [`docs/HANDOFF_SHREYANSH.md`](HANDOFF_SHREYANSH.md).
2. **App Runner → EC2 pivot:** initial ask was "deploy to AWS App Runner" per
   the original README. The AI verified the app runs and drafted an App Runner
   runbook — then the requester flagged that the assignment brief requires the
   deployment to cost **nothing**, and asked to check this against App Runner's
   actual pricing. That surfaced that App Runner has no free tier at all. The AI
   proposed the free alternative that still satisfies "AWS deployment": an EC2
   free-tier instance + a nip.io + Caddy trick for free HTTPS without owning a
   domain, and rewrote the runbook before any money was spent. (Wrong initial
   assumption → caught by re-reading the actual requirement → corrected before
   execution — good "challenges & resolutions" material.)
3. **Guided live deployment (this session):** the AI then walked the deploy
   step-by-step on the requester's Mac — install Docker, local container test
   (which also confirmed the Gemini key end-to-end), create the AWS account,
   set the budget alert *first*, launch the t3.micro + Elastic IP, SSH in,
   install Docker on the server, build + run the container, and stand up Caddy
   for HTTPS. Real issues hit and fixed along the way are in §11 (the macOS
   Downloads permission block on the key) and reflected throughout (the account
   turned out to use AWS's newer **credit-based free plan**, not the classic
   750-hour tier; region **eu-north-1**; Caddy run **as a Docker container**
   rather than a system package). Result: a live, HTTPS, $0 deployment at
   https://13-60-161-144.nip.io.
