# Shopping List — ChatGPT setup

ChatGPT can't drive your browser, so here the skill makes the **no-login list page** (a downloadable `.html` file). If you paste Amazon.sa product links, it uses them as the items' Amazon links; if you paste an Amazon list link, the page shows it as a banner. For a real Amazon list made for you, use the Claude Code version on your laptop.

## Custom GPT (paid ChatGPT plans)
1. ChatGPT → **Explore GPTs** → **Create** → **Configure** tab.
2. **Name:** Shopping List. **Description:** Shopping lists anyone can open — no login.
3. **Instructions:** paste all of `GPT-INSTRUCTIONS.md` (under 8,000 characters).
4. **Knowledge:** upload `list-template.html`.
5. **Capabilities:** turn on **Web Search** and **Code Interpreter & Data Analysis**.
6. Save (Only me, or Anyone with the link).
7. Try: "iced matcha latte groceries" → you get `iced-matcha-latte-list.html` to download and forward.

## Project instead
New Project → paste `GPT-INSTRUCTIONS.md` into the project instructions → add `list-template.html` to the project files.

## Tips
- ChatGPT often can't read Amazon.sa or Saudi grocery sites. Items it couldn't price show "Price not checked" — that's intended, not a bug.
- Paste Amazon links like `https://www.amazon.sa/dp/B0CRB3DCZ6` to make the Amazon buttons go to the exact product.
- Don't open the list in ChatGPT's canvas to share it — send the downloaded file (canvas links need a login).
