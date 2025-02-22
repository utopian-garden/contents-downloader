// 依存パッケージ
import fs from 'fs';
import path from 'path';

// 再帰的なファイル名取得
const walkFileSync = async (dirPath) => {
  // 指定したファイルがディレクトリ配下にある場合はパスを配列に格納
  const fileName = [];
  const walkSubDir = async (dirPath) => {
    fs.readdirSync(dirPath).forEach(async (someName) => {
      const nextPath = path.join(dirPath, someName);

      let someStat;
      try {
        someStat = fs.statSync(nextPath);
      } catch (err) {
        // do nothing
        void err;
      }

      // 配下に更にディレクトリがある場合は繰り返し実行
      if (someStat && someStat.isDirectory()) {
        await walkSubDir(nextPath);
      } else {
        fileName.push(someName);
      }
    });
  };

  if (dirPath && fs.existsSync(dirPath)) {
    await walkSubDir(dirPath);
  }

  return fileName;
};

export { walkFileSync };
