// 依存パッケージ
import consoleStamp from 'console-stamp-color';
import fs from 'fs-extra';
import path from 'path';
import sanitize from 'sanitize-filename';

consoleStamp(console, {
  format: ':date(yyyy/mm/dd HH:MM:ss.l) :label'
});

// ライブラリ
import { walkFileSync } from './walk.js';

// 設定ファイル
import appConfig from '../config/app-config.json' with { type: 'json' };

// 定義
const { orderBat, orderPs1, orderLst } = appConfig.fs.file;

const syncContent = async (tagKey, syncDirs, tagPosts) => {
  // ディレクトリ毎にループ
  for (let syncDir of syncDirs) {
    // ディレクトリ内のファイルを取得
    const targetDir = path.join(syncDir, sanitize(tagKey));
    const walkFiles = await walkFileSync(targetDir);

    // ファイル毎にループ
    for (let walkFile of walkFiles) {
      // テンプレートファイルを除外
      const orderFiles = [orderBat, orderLst, orderPs1];
      if (orderFiles.includes(walkFile)) {
        continue;
      }

      const { name: fileName } = path.parse(walkFile);
      const postId = fileName.split('_').pop().split('.').shift();

      // ファイルが Tag テーブルの post に存在するかチェック
      if (!tagPosts.includes(postId) || !fileName.match(['.*_.*'])) {
        // 存在しない場合はファイルを削除
        //logger.debug(tagKey, walkFile);
        fs.removeSync(path.join(targetDir, walkFile));
        fs.removeSync(path.join(targetDir, 'image', walkFile));
        fs.removeSync(path.join(targetDir, 'image', 'ok', walkFile));

        fs.removeSync(path.join(targetDir, walkFile));
        fs.removeSync(path.join(targetDir, 'video', walkFile));
        fs.removeSync(path.join(targetDir, 'video', 'ok', walkFile));
      }
    }
  }
};

export { syncContent };
