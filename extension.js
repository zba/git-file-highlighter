const vscode = require('vscode');
const cp = require('child_process');
const path = require('path');

// Функция для получения списка измененных файлов из git diff
let filesChangedCache = {}; // Кэш измененных файлов
let lastCallTime = {}; // Время последнего вызова для каждого ref

// Функция для получения списка измененных файлов из git diff с throttle
async function getFilesChanged(ref) {
  const now = Date.now();
  if (filesChangedCache[ref] && now - lastCallTime[ref] < 100) {
    return filesChangedCache[ref]; // Возвращаем из кэша, если вызов был меньше 100 мс назад
  }

  lastCallTime[ref] = now; // Обновляем время последнего вызова

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
  async provideFileDecoration(uri) {
    const config = vscode.workspace.getConfiguration('gitFileHighlight');
    const refs = config.get('refs');

    // Получаем относительный путь к файлу
    const relativePath = vscode.workspace.asRelativePath(uri);

    // Проверяем, относится ли файл к какому-либо ref
    for (const refN of [1,2,3]) {
      const ref = config.get('ref' + refN);
      if (!ref) continue;
      const color = 'gitFileHighlight.ref' + refN + 'Color';
      const filesChanged = await getFilesChanged(ref);
      if (filesChanged.includes(relativePath)) {
        return new vscode.FileDecoration(null, null, new vscode.ThemeColor(color));
      }
    }

    return undefined; // Если файл не нуждается в декорации
  }
}

function activate(context) {
  // Регистрация провайдера декораций
  const decorationProvider = new GitFileDecorationProvider();
  context.subscriptions.push(vscode.window.registerFileDecorationProvider(decorationProvider));

  // Обновляем декорации при изменении дерева файлов
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => {
    decorationProvider.fireDidChangeFileDecorations();
  }));
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};