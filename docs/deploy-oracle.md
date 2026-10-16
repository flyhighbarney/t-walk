# Run T-Walk on Oracle Cloud's free tier

This guide takes you from no account to T-Walk running at an `https://` address
on a server that costs nothing. It takes about 30 minutes, most of it waiting.

What you get:
- Live departures, the map, navigation, sharing and saved commutes.
- Trip planning with T-Walk's **built-in planner**. It needs no extra memory, so
  the smallest free server is enough.
- HTTPS with a free certificate, restarts on crashes and reboots, and a fresh
  MBTA timetable every 6 hours.

The same steps work on any Ubuntu 24.04 server; only Part 1 is Oracle-specific.

---

## Part 1: Create the account and the server

### 1.1 Sign up

1. Go to [signup.cloud.oracle.com](https://signup.cloud.oracle.com) and choose **Start for free**.
2. Enter your name, email and country, and confirm your email.
3. **Choose your home region carefully: it can't be changed.** Free servers can only
   be created there. Pick one near your users, for example **US East (Ashburn)** for
   Boston. Ashburn is popular and often out of free ARM servers; **US Midwest (Chicago)**
   is a quieter alternative.
4. Add your address and a card. The card is checked with a small temporary hold.
   A Free Tier account isn't charged unless you upgrade it.
5. Wait for the "account is ready" email, then sign in at [cloud.oracle.com](https://cloud.oracle.com).

### 1.2 Make an SSH key (on your own computer)

Skip this if you already have one you want to use.

```bash
ssh-keygen -t ed25519 -f ~/.ssh/t-walk -C t-walk
```

Copy the **public** half: the contents of `~/.ssh/t-walk.pub`, one line starting with
`ssh-ed25519`. Never share the file without `.pub`.

### 1.3 Create the server

1. Open the **☰** menu → **Compute** → **Instances** → **Create instance**.
2. **Name:** `t-walk`.
3. **Image and shape** → **Edit**:
   - **Image** → **Change image** → **Canonical Ubuntu 24.04** (the *Minimal* image is
     fine too and uses less memory).
   - **Shape** → **Change shape**, then pick one:

     | Shape | Free size | Good for |
     |---|---|---|
     | **AMD** → `VM.Standard.E2.1.Micro` | 1 CPU (shared), 1 GB | T-Walk with the built-in planner. Almost always available. |
     | **Ampere** → `VM.Standard.A1.Flex` | up to 2 CPUs and 12 GB | The same, plus optionally OpenTripPlanner (see Part 5). Often "out of capacity". |

     Both show **Always Free-eligible**.
4. **Networking:** leave **Create new virtual cloud network** selected, and make sure
   **Assign a public IPv4 address** is on.
5. **Add SSH keys** → **Paste public keys** → paste the `ssh-ed25519 …` line.
6. Leave the boot volume as it is (it's within the free 200 GB).
7. Click **Create**. When the state turns **Running**, copy the **Public IP address**.

**"Out of capacity for shape VM.Standard.A1.Flex"?** That's common for ARM:
- try another **Availability domain** under *Placement*;
- ask for 1 CPU / 6 GB instead of 2 / 12;
- try again later;
- or use the AMD micro, which is enough for T-Walk.

### 1.4 Open the web ports in Oracle's network

New Oracle networks only let SSH in.

1. On the instance page, click the **Subnet** link → **Security Lists** →
   **Default Security List** → **Add Ingress Rules**.
2. Source CIDR `0.0.0.0/0`, IP protocol **TCP**, destination port range `80,443`.
3. Click **Add Ingress Rules**.

(The server has its own firewall too; the setup script opens it.)

---

## Part 2: Install T-Walk (one script)

### 2.1 Log in

```bash
ssh -i ~/.ssh/t-walk ubuntu@YOUR.PUBLIC.IP
```

Answer `yes` the first time.

### 2.2 Pick the address for HTTPS

- **No domain?** Use the free [sslip.io](https://sslip.io) name: your IP with dashes,
  e.g. IP `203.0.113.7` becomes `203-0-113-7.sslip.io`. Nothing to set up.
- **Own domain?** Add an `A` record pointing it at the server's IP, then use that name.

### 2.3 Run the setup

```bash
sudo apt-get update && sudo apt-get install -y git
sudo git clone https://github.com/flyhighbarney/t-walk.git /opt/t-walk
sudo bash /opt/t-walk/deploy/oracle/setup.sh 203-0-113-7.sslip.io
```

Replace the last part with your name from 2.2. The script ([setup.sh](../deploy/oracle/setup.sh)):

1. Adds 2 GB of swap on machines with under 3 GB of memory.
2. Installs curl, git, Caddy (HTTPS) and iptables-persistent.
3. Opens ports 80 and 443 in the server's firewall, and keeps them open after reboots.
4. Installs Node 24.
5. Creates a `twalk` user to run T-Walk without admin rights.
6. Installs and builds T-Walk (a few minutes on the micro).
7. Writes `/opt/t-walk/.env` with safe defaults and push-notification keys.
8. Installs the `t-walk` service ([t-walk.service](../deploy/oracle/t-walk.service)) and starts it.
9. Points Caddy at it for your name. Caddy gets the certificate by itself.
10. Waits until T-Walk answers. **The first start downloads and imports the MBTA
    timetable: 1–3 minutes.**

It ends with `T-Walk is up: https://…`. Open that address on your phone.

### 2.4 Check it

```bash
systemctl status t-walk caddy --no-pager      # both "active (running)"
curl -s http://127.0.0.1:8787/api/health      # every feed should say "live"
sudo journalctl -u t-walk -n 30 --no-pager    # the server's log
```

---

## Part 3: Settings

All settings are in `/opt/t-walk/.env`:

```bash
sudo -u twalk nano /opt/t-walk/.env
sudo systemctl restart t-walk
```

| Setting | What it does |
|---|---|
| `MBTA_API_KEY` | Optional, free from [api-v3.mbta.com/portal](https://api-v3.mbta.com/portal). With it, live data streams. Without it, T-Walk polls the public feeds every 10 s; alerts work either way. |
| `CONTACT` | Who you are, sent to the MBTA and the weather service in the User-Agent, as they ask. Put an email or URL. |
| `OTP_URL` | `off` uses the built-in planner. A URL (e.g. `http://127.0.0.1:8080`) uses OpenTripPlanner first. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Push-notification keys, made by the setup. Changing them cancels existing subscriptions. |

The service itself fixes `HOST=127.0.0.1`, `PORT=8787` and `DATA_DIR=/var/lib/t-walk`.
Only Caddy faces the internet.

---

## Part 4: Updating

```bash
sudo bash /opt/t-walk/deploy/oracle/update.sh
```

It pulls the latest code, reinstalls, rebuilds the app and restarts
([update.sh](../deploy/oracle/update.sh)). The MBTA timetable refreshes itself every 6 hours.

---

## Part 5 (optional): OpenTripPlanner for street-by-street walks

The built-in planner estimates walks as straight lines × 1.3. In tests on 15 Boston
trips it arrived within 2 minutes of OpenTripPlanner on the median, and 9 minutes
apart at worst (`node tools/compare-planners.ts`).

OpenTripPlanner adds:
- real walking routes and turn-by-turn steps,
- step-free routing.

It needs about **5 GB of memory** to run and more to build its graph, so only the
Ampere server can host it:

```bash
sudo apt-get install -y openjdk-25-jre-headless    # OTP 2.10 needs Java 25
cd /opt/t-walk
sudo -u twalk npm run otp:fetch                    # OTP, OpenStreetMap for MA + RI, MBTA GTFS
sudo -u twalk npm run otp:build -- --heap=7G       # about 5-10 minutes
```

Then run `npm run otp:serve` as a second service, and set `OTP_URL=http://127.0.0.1:8080`
in `.env`. Without enough memory, build the graph on another computer and copy
`otp/data/graph.obj` across. T-Walk keeps working on the built-in planner whenever
OTP is down.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| The page doesn't load at all | Check Part 1.4: ports 80 and 443 must be in the security list. Then `sudo iptables -L INPUT -n` should show ACCEPT for 80 and 443 before the REJECT line. |
| Browser warns about the certificate | Caddy can't get one until ports 80/443 are reachable. Fix the ports, then `sudo systemctl restart caddy` and see `sudo journalctl -u caddy -n 50`. |
| `T-Walk is still starting` at the end of setup | The first timetable import can take a few minutes on the micro. Watch it with `sudo journalctl -u t-walk -f` until it says `Listening`. |
| Times show "Scheduled" everywhere | The live feed is down or blocked: see `curl -s http://127.0.0.1:8787/api/health`. |
| Out of memory during `npm run build` | Check the swap is on (`swapon --show`). Rerunning setup adds it. |
| SSH stops working after a few days of inactivity | Oracle can reclaim Always Free servers that sit nearly idle for 7 days. T-Walk's live connection normally keeps it busy enough. Upgrading the account to Pay As You Go (still free within the Always Free limits) avoids it. |

---

## Costs and limits

- **Oracle Always Free:** 2 AMD micro servers (1 GB each) and Ampere capacity of up
  to 2 CPUs and 12 GB in total, 200 GB of disk and 10 TB of outgoing traffic a month.
  Limits change; check Oracle's Free Tier page.
- **MBTA data** is free under the [MassDOT Developers License Agreement](https://github.com/mbta/gtfs-documentation/blob/master/developers-license-agreement.pdf).
  Keep the attribution T-Walk shows, don't present your site as the MBTA's, and
  don't use MBTA or MassDOT logos.
- **Map tiles** come from [OpenFreeMap](https://openfreemap.org) (free, no key). **Address
  search** comes from [Photon](https://photon.komoot.io) (free, fair use: T-Walk caches and
  spaces its requests).
