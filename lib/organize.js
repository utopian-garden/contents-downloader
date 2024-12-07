// 依存パッケージ
import fs from 'fs-extra';
import path from 'path';
import sanitize from 'sanitize-filename';
import consoleStamp from 'console-stamp-color';

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
const msg = appConfig.organize.msg;
const rule = appConfig.organize.rule;
const tab = appConfig.db.tab;
const threshold = appConfig.organize.threshold;

// ファイルの仕分け
const fileOrganize = async () => {
  // DB スキャン
  let tagItems = [];
  tagItems = await ddb.scanAll(tab.dlTable);

  // スキャン結果でループ
  console.info(msg.startMsg);

  const dlDirs = [
    dir.dlImageDir,
    dir.dlVideoDir
  ];

  for (let tagItem of tagItems) {
    for (let dlDir of dlDirs) {
      const tagDir = path.join(dlDir, sanitize(tagItem.tag));
      const tagSubDirFiles = await walk.walkFileSync(tagDir);

      // 続行条件のチェック
      if (tagSubDirFiles.length > threshold.fileCount) {
        // ファイル名でループ
        const tagDirFiles = fs.readdirSync(tagDir);
        for (let tagDirFile of tagDirFiles) {
          // 仕分けルールでループ
          for (let type of rule.assortRule) {
            // ファイルタイプ毎に合致するサブディレクトリに移動
            if (path.extname(tagDirFile) === type.fileExt) {
              const fromFile = path.join(tagDir, tagDirFile);
              const toDir = path.join(tagDir, type.fileType);
              const toFile = path.join(toDir, tagDirFile);
              fs.ensureDirSync(toDir);
              fs.moveSync(fromFile, toFile);
              break;
            }
          }
        }
      }
    }
  }

  console.info(msg.finMsg);
};

const organize = { fileOrganize };
export default organize;
