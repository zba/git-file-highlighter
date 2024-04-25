const vscode = require('vscode');
const cp = require('child_process');
const path = require('path');

let filesChangedCache = {}; // Кэш измененных файлов
let lastCallTime = {}; // Время последнего вызова для каждого ref

async function getFilesChanged(ref) {
  const now = Date.now();
  if (filesChangedCache[ref] && now - lastCallTime[ref] < 100) {
    return filesChangedCache[ref];
  }

  lastCallTime[ref] = now;

  return new Promise((resolve, reject) => {
    const child = cp.spawn('git', ['diff', `${ref}`, `${ref}^`, '--name-only'], { cwd: vscode.workspace.rootPath });
    let stdout = '';
    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`git diff exited with code ${code}`));
        return;
      }
      const filesChanged = stdout.trim().split('\n');
      filesChangedCache[ref] = filesChanged; 
      resolve(filesChanged);
    });
  });
}

class GitFileDecorationProvider {
  constructor() {
    this._onDidChangeFileDecorations = new vscode.EventEmitter();
    this.onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;
  }

  async provideFileDecoration(uri) {
    const config = vscode.workspace.getConfiguration('gitFileHighlight');
    const refs = config.get('refs');
    const relativePath = vscode.workspace.asRelativePath(uri);

    for (const refN of [1, 2, 3]) {
      const ref = config.get('ref' + refN);
      if (!ref) continue;
      const color = 'gitFileHighlight.ref' + refN + 'Color';
      const filesChanged = await getFilesChanged(ref);
      if (filesChanged.includes(relativePath)) {
        return new vscode.FileDecoration(null, null, new vscode.ThemeColor(color));
      }
    }

    return undefined;
  }

  fireDidChangeFileDecorations() {
    this._onDidChangeFileDecorations.fire();
  }
}

function activate(context) {
  const decorationProvider = new GitFileDecorationProvider();
  context.subscriptions.push(vscode.window.registerFileDecorationProvider(decorationProvider));
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => {
    decorationProvider.fireDidChangeFileDecorations();
  }));

  // Обновляем декорации при изменении конфигурации
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration('gitFileHighlight')) {
      decorationProvider.fireDidChangeFileDecorations();
    }
  }));

  // Обновляем декорации при изменении файлов в рабочем пространстве
  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(document => {
    const uri = document.uri;
    const relativePath = vscode.workspace.asRelativePath(uri);
    const config = vscode.workspace.getConfiguration('gitFileHighlight');
    for (const refN of [1, 2, 3]) {
      const ref = config.get('ref' + refN);
      if (ref && filesChangedCache[ref]?.includes(relativePath)) {
        decorationProvider.fireDidChangeFileDecorations();
        break;
      }
    }
  }));
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};
