# Move Team Bridge to a Windows PC

For a Claude Code session running **on the PC**. Shahed isn't a developer: do the work yourself, keep messages short,
and only ask him for the steps marked **(Shahed)**. Never print keys or tokens.

Result: the bridge, n8n and the tunnel run on the PC, start by themselves, and `bridge.shahed.win` / `n8n.shahed.win` point to it.
The AI work runs through Claude Code and Codex on his subscriptions (`AI_ENGINE=subscription`), so no API cost.

## 1. Install (PowerShell)
```powershell
winget install -e --id OpenJS.NodeJS.LTS      # needs Node 22.13 or newer: check with node -v
winget install -e --id Git.Git
winget install -e --id Cloudflare.cloudflared
npm install -g @openai/codex n8n
```
Open a new PowerShell window afterwards so the new programs are on PATH.

## 2. Sign in to the subscriptions **(Shahed)**
- `codex login` → **Sign in with ChatGPT**. Check: `codex login status`.
- Claude Code is already signed in if this session runs. It must use his **Claude account**, not an API key:
  `claude` → `/status` should not mention an API key.

## 3. Get the bridge
```powershell
cd $HOME
git clone -b claude/chatgpt-claude-mcp-bridge https://github.com/VGaseven/VG-hoster.git   # sign in to GitHub if a window asks (Shahed)
cd VG-hoster
npm install
npm test
```

## 4. Bring the settings and memory from the Mac
On the Mac (a Remote Control session there can do it), the files are `~/VG-hoster/.env` and `~/VG-hoster/data/` (the database and backups).
- Stop the Mac bridge first (`lsof -ti:3000 | xargs kill`) so the database isn't being written while it's copied.
- Copy both to `%USERPROFILE%\VG-hoster\` on the PC (AirDrop isn't available, so use a USB stick, iCloud Drive or Google Drive, then delete the cloud copy).
- In the PC's `.env`: set `AI_ENGINE=subscription`, `TRUST_PROXY=1`, `N8N_API_URL=http://localhost:5678`. Leave the API keys empty.

## 5. n8n
n8n had no workflows on the Mac, so start fresh: run `n8n start`, open http://localhost:5678, create the owner account **(Shahed)**,
then **Settings → n8n API → Create an API key** **(Shahed)** and put it in `.env` as `N8N_API_KEY`.

## 6. Start everything at login
Create `start-bridge.cmd` in `%USERPROFILE%\VG-hoster`:
```bat
@echo off
cd /d "%USERPROFILE%\VG-hoster"
start "n8n" /min cmd /c n8n start
node --env-file=.env server.js >> bridge.log 2>&1
```
Register it, and stop Windows from sleeping while plugged in:
```powershell
schtasks /create /tn "Team Bridge" /sc onlogon /rl limited /tr "\"%USERPROFILE%\VG-hoster\start-bridge.cmd\""
powercfg /change standby-timeout-ac 0
schtasks /run /tn "Team Bridge"
```
Check: `curl http://localhost:3000/health` → `{"ok":true}`.

## 7. Point the domain to the PC **(Shahed, in the Cloudflare dashboard)**
1. Cloudflare → **Zero Trust → Networks → Tunnels → Create a tunnel** → name it `pc`, type **Cloudflared**.
2. Copy the install command it shows for **Windows** and run it in an **admin** PowerShell. It installs the tunnel as a Windows service.
3. **Public hostnames:** first remove `bridge.shahed.win` and `n8n.shahed.win` from the old Mac tunnel (or delete that tunnel),
   then add them to `pc`: `bridge.shahed.win` → `http://localhost:3000`, `n8n.shahed.win` → `http://localhost:5678`.
4. Turn off the Mac's tunnel and bridge so they don't compete.

Nothing else changes: the Claude, ChatGPT and Bob connectors and the GitHub webhook all use the same addresses.

## 8. Final check
- `https://bridge.shahed.win/health` answers from the phone.
- Dashboard → **Settings → Test both** shows `claude: ✓ works` and `codex: ✓ works`.
- Post a message to Claude in team chat; the reply arrives with no API spend.

Then tell Shahed in three lines: what works, what (if anything) he still needs to click, and that the Mac no longer needs to stay on.
