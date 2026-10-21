import * as fs from 'fs';
import * as vscode from 'vscode';

const VIEW_TYPE = 'bizDataSandbox';

// Maps the sandbox's language tabs to VS Code language identifiers.
const LANGUAGE_IDS: Record<string, string> = {
  sql: 'sql',
  r: 'r',
  eviews: 'plaintext',
};

type WebviewMessage =
  | { type: 'openInEditor'; language: string; code: string }
  | { type: 'copy'; code: string };

let currentPanel: vscode.WebviewPanel | undefined;

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('bizDataSandbox.start', () => openSandbox(context)),
  );
}

export function deactivate(): void {
  currentPanel?.dispose();
}

function openSandbox(context: vscode.ExtensionContext): void {
  if (currentPanel) {
    currentPanel.reveal(vscode.ViewColumn.One);
    return;
  }

  const mediaRoot = vscode.Uri.joinPath(context.extensionUri, 'media');
  const panel = vscode.window.createWebviewPanel(VIEW_TYPE, 'BizData Sandbox', vscode.ViewColumn.One, {
    enableScripts: true,
    retainContextWhenHidden: true,
    localResourceRoots: [mediaRoot],
  });
  currentPanel = panel;

  panel.webview.html = getHtml(panel.webview, mediaRoot);

  panel.webview.onDidReceiveMessage(
    (message: WebviewMessage) => handleMessage(message),
    undefined,
    context.subscriptions,
  );

  panel.onDidDispose(
    () => {
      currentPanel = undefined;
    },
    undefined,
    context.subscriptions,
  );
}

async function handleMessage(message: WebviewMessage): Promise<void> {
  switch (message.type) {
    case 'openInEditor': {
      const doc = await vscode.workspace.openTextDocument({
        language: LANGUAGE_IDS[message.language] ?? 'plaintext',
        content: message.code,
      });
      await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
      return;
    }
    case 'copy':
      await vscode.env.clipboard.writeText(message.code);
      vscode.window.setStatusBarMessage('BizData Sandbox: code copied to clipboard', 2500);
      return;
  }
}

function getHtml(webview: vscode.Webview, mediaRoot: vscode.Uri): string {
  const asset = (file: string) => webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, file));
  const body = fs.readFileSync(vscode.Uri.joinPath(mediaRoot, 'body.html').fsPath, 'utf8');
  const nonce = createNonce();
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource}`,
    `img-src ${webview.cspSource} data:`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${asset('main.css')}">
  <title>BizData Sandbox</title>
</head>
<body>
${body}
  <script nonce="${nonce}" src="${asset('scenarios.js')}"></script>
  <script nonce="${nonce}" src="${asset('main.js')}"></script>
</body>
</html>`;
}

function createNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let i = 0; i < 32; i++) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}
