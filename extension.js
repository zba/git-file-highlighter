const vscode = require('vscode');
const cp = require('child_process');
const path = require('path');

let filesChangedCache = {}; // Кэш измененных файлов
let lastCallTime = {}; // Время последнего вызова для каждого ref

async function getGitRoot(cwd) {
  return new Promise((resolve, reject) => {
    const child = cp.spawn('git', ['rev-parse', '--show-toplevel'], { cwd });
    let stdout = '';
    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    child.stderr.on('data', (data) => {
      reject(new Error(data.toString()));
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error('Failed to find Git repository root.'));
      }
    });
  });
}

async function getFilesChanged(ref) {
  const now = Date.now();
  if (filesChangedCache[ref] && now - lastCallTime[ref] < 100) {
    return filesChangedCache[ref];
  }

  lastCallTime[ref] = now;

  const editor = vscode.window.activeTextEditor;
  const cwd = editor ? path.dirname(editor.document.uri.fsPath) : vscode.workspace.rootPath;
  const gitRoot = await getGitRoot(cwd);

  const gitDiffPromise = new Promise((resolve, reject) => {
    const child = cp.spawn('git', ['diff', `${ref}`, `${ref}^`, '--name-only', '--relative'], { cwd: gitRoot });
    let stdout = '';
    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`git diff exited with code ${code}`));
        return;
      }
      resolve(stdout.trim().split('\n').map(file => path.normalize(path.resolve(gitRoot, file))));
    });
  });

  const gitStatusPromise = new Promise((resolve, reject) => {
    const child = cp.spawn('git', ['status', '--porcelain'], { cwd: gitRoot });
    let stdout = '';
    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`git status exited with code ${code}`));
        return;
      }
      // Filter out only modified or untracked files
      resolve(stdout.trim().split('\n')
        .filter(line => line.startsWith(' M') || line.startsWith('??'))
        .map(line => path.normalize(path.resolve(gitRoot, line.slice(3)))));
    });
  });

  try {
    const [diffFiles, statusFiles] = await Promise.all([gitDiffPromise, gitStatusPromise]);
    const filesChanged = diffFiles.filter(file => !statusFiles.includes(file));
    filesChangedCache[ref] = filesChanged;
    return filesChanged;
  } catch (error) {
    console.error('Error fetching changed files:', error);
    return [];
  }
}


class GitFileDecorationProvider {
  constructor() {
    this._onDidChangeFileDecorations = new vscode.EventEmitter();
    this.onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;
  }

  async provideFileDecoration(uri) {
    const config = vscode.workspace.getConfiguration('gitFileHighlight');
    const fullPath = path.resolve(uri.fsPath).replace(/^[a-z]:/, (char)=>char.toUpperCase())
    const relativePath = vscode.workspace.asRelativePath(uri, false);

    for (const refN of [1, 2, 3]) {
      const ref = config.get('ref' + refN);
      if (!ref) continue;
      const color = 'gitFileHighlight.ref' + refN + 'Color';
      const filesChanged = await getFilesChanged(ref);
      if (filesChanged.some(changedPath => fullPath === changedPath || changedPath.startsWith(fullPath))) {
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

  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration('gitFileHighlight')) {
      decorationProvider.fireDidChangeFileDecorations();
    }
  }));

  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(document => {
    decorationProvider.fireDidChangeFileDecorations();
  }));
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};
