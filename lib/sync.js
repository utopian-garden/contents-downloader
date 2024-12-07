// 依存パッケージ
import consoleStamp from 'console-stamp-color';
import fs from 'fs-extra';
import log4js from 'log4js';
import path from 'path';
import sanitize from 'sanitize-filename';

consoleStamp(console, {
  format: ':date(yyyy/mm/dd HH:MM:ss.l) :label'
});

// ライブラリ
import ddb from './ddb.js';
import walk from './walk.js';

// 設定ファイル
import appConfig from '../config/app-config.json' with { type: 'json' };

// 定義
const dir = appConfig.fs.dir;
const file = appConfig.fs.file;
const tab = appConfig.db.tab;

// DB のディレクトリの修正処理
const syncContent = async (syncType) => {
  let tabName;
  let syncDirs;

  // 初期化
  log4js.configure('./config/sync-log-config.json');
  const logger = log4js.getLogger('system');

  // 引数によるパラメータ設定
  switch (syncType) {
    case tab.dlTable:
      tabName = tab.dlTable;
      syncDirs = [
        dir.dlImageDir,
        dir.dlVideoDir,
        dir.dlImageOkDir,
        dir.dlVideoOkDir
      ];
      break;

    case tab.igTable:
      tabName = tab.igTable;
      syncDirs = [
        dir.igDir,
        dir.igNgDir
      ];
      break;

    case tab.artTable:
      tabName = tab.artTable;
      syncDirs = [
        dir.artDir
      ];
      break;

    case tab.stuTable:
      tabName = tab.stuTable;
      syncDirs = [
        dir.stuDir
      ];
      break;
  }

  // ループ処理開始
  const tabItems = await ddb.scanAll(tabName);
  for (let tabItem of tabItems) {
    // DB スキャン
    const tagKey = tabItem.tag;
    const tagTable = tab.tagTable;
    const tagItem = await ddb.getItem(tagTable, tagKey);

    // タグのレコードがない場合はスキップ
    if (!tagItem.Item) {
      continue;
    } else {
      logger.debug(tagKey);
    }

    // ディレクトリ毎にループ
    for (let syncDir of syncDirs) {
      // ディレクトリ内のファイルを取得
      const targetDir = path.join(syncDir, sanitize(tagKey));
      const walkFiles = await walk.walkFileSync(targetDir);

      // ファイル毎にループ
      for (let walkFile of walkFiles) {
        // テンプレートファイルを除外
        const orderFiles = [
          file.orderBat,
          file.orderLst,
          file.orderPs1
        ];
        if (orderFiles.includes(walkFile) || walkFile.match(/^sample-.*$/)) {
          continue;
        }

        const fileName = Number(path.parse(walkFile).name);
        const tagPosts = tagItem.Item.post;

        // ファイルが Tag テーブルの post に存在するかチェック
        if (!tagPosts.includes(fileName)) {
          // 存在しない場合はファイルを削除
          //logger.debug(tagKey, walkFile);
          fs.removeSync(path.join(targetDir, walkFile));
          fs.removeSync(path.join(targetDir, 'image', walkFile));
          fs.removeSync(path.join(targetDir, 'image', 'ok', walkFile));
        }
      }
    }
  }
};

// メイン処理の起動
const syncType = process.argv[2];

if (syncType) {
  syncContent(syncType);
} else {
  console.info('Usage: node ' + path.basename(process.argv[1]) +
    ' <confirmType (Download/Ignore/Artist/Studio)>');
}
