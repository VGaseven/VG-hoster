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
  <header class="app-header">
    <div>
      <h1>BizData Sandbox</h1>
      <p class="tagline">Learn real business data workflows in SQL, R and EViews &mdash; then see what the numbers do.</p>
    </div>
    <nav class="module-picker" id="modulePicker" aria-label="Business module"></nav>
  </header>

  <main class="layout">
    <section class="card scenario" aria-labelledby="scenarioTitle">
      <div class="eyebrow" id="scenarioModule"></div>
      <h2 id="scenarioTitle"></h2>
      <p id="scenarioProblem"></p>
      <ol class="workflow" id="scenarioWorkflow"></ol>
      <details class="concepts">
        <summary>Key concepts</summary>
        <dl id="scenarioConcepts"></dl>
      </details>
    </section>

    <section class="card code" aria-label="Code">
      <div class="tabs" role="tablist" id="langTabs"></div>
      <div class="code-meta">
        <span id="codeCaption"></span>
        <span class="code-actions">
          <button type="button" class="secondary" id="resetBtn" title="Restore the reference solution">Reset</button>
          <button type="button" class="secondary" id="copyBtn">Copy</button>
          <button type="button" id="openBtn" title="Open this snippet in a new editor tab">Open in editor</button>
        </span>
      </div>
      <textarea id="codeEditor" spellcheck="false" aria-label="Code editor"></textarea>
      <p class="hint" id="codeHint"></p>
    </section>

    <section class="card simulator" aria-labelledby="simTitle">
      <h2 id="simTitle">Live simulator</h2>
      <p class="hint">Move the sliders to see what running this workflow against a database would return. The code above updates with your parameters.</p>
      <div class="controls" id="simControls"></div>
      <div class="kpis" id="simKpis"></div>
      <div class="chart" id="simChart" role="img"></div>
      <div class="table-wrap"><table id="simTable"></table></div>
    </section>
  </main>

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
