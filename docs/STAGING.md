# Private test copy of the Hub (30 minutes)

This starts a separate copy of the new Hub on your Mac, so you can try a real reply without touching the Hub you use every day.

## What it does

- Runs only on your Mac, at `http://127.0.0.1:4400` (or the next free number). Nobody on the internet or your Wi-Fi can open it.
- Starts with a brand-new, empty database in a temporary folder. Your real chats, files and settings are not used or changed.
- Does not read `.env`, and your current Hub token stays the same.
- Telegram, schedules, MCP and other outside actions are off. Only a private chat with Claude can reply, using the Claude app login already on this Mac (no paid API).
- Stops by itself after 30 minutes and deletes its temporary folder. Press Ctrl+C to stop it sooner.

## Your phrase

The script asks you to choose a phrase (8 characters or more) and type it twice. Nothing shows while you type. It is kept only in the test copy's memory while it runs and is never saved to a file, a log or your Terminal history. Don't send it to anyone, including the assistants.

## Steps

1. Open Terminal and run this one command (change `~/VG-hoster` if your Hub folder is somewhere else):

   ```
   cd ~/VG-hoster && git fetch origin claude/whatsapp-chat-nav && bash <(git show FETCH_HEAD:scripts/staging.sh)
   ```

2. When it asks, type your own phrase, then type it again.
3. Open the link it prints, for example `http://127.0.0.1:4400/`, and unlock it with your phrase.
4. Tap **+ New chat**, choose **One assistant (private)** and **Claude**, then **Open chat**. Tick **Request a private reply** and send one short test message.
5. Wait for Claude's answer to appear. Then close the Terminal window or press Ctrl+C.

## For reviewers

`scripts/staging.sh` copies the `claude/whatsapp-chat-nav` branch into a `mktemp` folder with `git archive` and runs it with `HUB_STAGING=1`. The environment is cleared, so no keys from the shell reach it. In staging mode the server refuses to start without a phrase, `/mcp` returns 403, and every API write except storing chat messages and private Claude replies returns 403. `STAGING_SECONDS`, `STAGING_PORT` and `STAGING_REF` override the timer, port and code version for testing. `test/staging.test.js` covers this mode.
