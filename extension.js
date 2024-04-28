const vscode = require('vscode');
const cp = require('child_process');
const path = require('path');

// Функция для выполнения команды spawn и возврата промиса
async function runSpawnCommand(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = cp.spawn(command, args, options);
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`Command failed with code ${code}: ${stderr}`));
      }
    });
  });
}

async function getGitRoot(cwd) {
  try {
    const result = await runSpawnCommand('git', ['rev-parse', '--show-toplevel'], { cwd });
    return result;
  } catch (error) {
    throw new Error('Failed to find Git repository root.');
  }
}

let filesChangedPromise; // Глобальный промис для всех ref

async function getAllFilesChanged() {
    if (filesChangedPromise) {
        return filesChangedPromise;
    }

    filesChangedPromise = (async () => {
        const config = vscode.workspace.getConfiguration('gitFileHighlight');
        const refs = ['ref1', 'ref2', 'ref3'];
        const filesChanged = {};
        const editor = vscode.window.activeTextEditor;
        const cwd = editor ? path.dirname(editor.document.uri.fsPath) : vscode.workspace.rootPath;
        const gitRoot = path.normalize(await getGitRoot(cwd));

        for (const refName of refs) {
            const ref = config.get(refName);
            if (!ref) continue;

            try {
                const diffFiles = await runSpawnCommand(
                    'git',
                    ['log', '--pretty=format:', '--name-only', `${ref}...${ref}^`, '--relative'],
                    { cwd: gitRoot }
                );
                const statusFiles = await runSpawnCommand('git', ['status', '--porcelain'], { cwd: gitRoot });
                const changedFiles = diffFiles
                    .split('\n')
                    .map(file => path.normalize(path.resolve(gitRoot, file)))
                    .filter(file => !statusFiles.includes(file));

                for (const file of changedFiles) {
                    let currentPath = file;
                    while (currentPath.startsWith(gitRoot) && currentPath !== gitRoot) {
                        if (!filesChanged[currentPath]) { // Только если путь еще не помечен
                            filesChanged[currentPath] = refName;
                        }
                        currentPath = path.dirname(currentPath); // Поднимаемся к родительской директории
                    }
                }
            } catch (error) {
                console.error('git file highlighter: Error fetching changed files for', refName, ':', error);
            }
        }

        filesChangedPromise = null; // Сброс промиса после сбора данных
        return filesChanged;
    })();

    return await filesChangedPromise;
}



class GitFileDecorationProvider {
  constructor() {
    this._onDidChangeFileDecorations = new vscode.EventEmitter();
    this.onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;
  }

  async provideFileDecoration(uri) {
    const filesChanged = await getAllFilesChanged();
    const fullPath = path.resolve(uri.fsPath).replace(/^[a-z]:/, char => char.toUpperCase());

    if (filesChanged[fullPath]) {
        const refName = filesChanged[fullPath];
        const color = `gitFileHighlight.${refName}Color`;
        return new vscode.FileDecoration(null, null, new vscode.ThemeColor(color));
    }

    return undefined;
  }

  fireDidChangeFileDecorations(...args) {
    console.log('git file highlight: fireDidChangeFileDecorations', args);
    this._onDidChangeFileDecorations.fire();
  }
}

function activate(context) {
  const decorationProvider = new GitFileDecorationProvider();
  context.subscriptions.push(vscode.window.registerFileDecorationProvider(decorationProvider));
  const fireDidChange = decorationProvider.fireDidChangeFileDecorations.bind(decorationProvider);
  // Слушатель изменений в файловой системе
  const watcher = vscode.workspace.createFileSystemWatcher('**/*');
  context.subscriptions.push(watcher);

  watcher.onDidChange(fireDidChange);

  watcher.onDidCreate(fireDidChange);

  watcher.onDidDelete(fireDidChange);

  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(fireDidChange));

  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration('gitFileHighlight')) {
      fireDidChange();
    }
  }));

  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(fireDidChange));
}

function deactivate() {
  
}

module.exports = {
  activate,
  deactivate
};
