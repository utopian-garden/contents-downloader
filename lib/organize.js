// 依存パッケージ
import fs from 'fs-extra';
import path from 'path';
import sanitize from 'sanitize-filename';
import consoleStamp from 'console-stamp-color';

consoleStamp(console, {
  format: ':date(yyyy/mm/dd HH:MM:ss.l) :label'
});

// ライブラリ
import { scanAll } from './ddb.js';
import { walkFileSync } from './walk.js';

// 設定ファイル
import appConfig from '../config/app-config.json' with { type: 'json' };

// 定義
const { dlImageDir, dlVideoDir } = appConfig.fs.dir;
const { startMsg, finMsg } = appConfig.organize.msg;
const { assortRule } = appConfig.organize.rule;
const { dlTable } = appConfig.db.tab;
const { fileCount } = appConfig.organize.threshold;

// ファイルの仕分け
const fileOrganize = async () => {
  // DB スキャン
  let tagItems = [];
  tagItems = await scanAll(dlTable);

  // スキャン結果でループ
  console.info(startMsg);

  const dlDirs = [dlImageDir, dlVideoDir];

  for (let tagItem of tagItems) {
    const { tag: tagName } = tagItem;

    for (let dlDir of dlDirs) {
      const tagDir = path.join(dlDir, sanitize(tagName));
      const tagSubDirFiles = await walkFileSync(tagDir);

      // 続行条件のチェック
      if (tagSubDirFiles.length > fileCount) {
        // ファイル名でループ
        const tagDirFiles = fs.readdirSync(tagDir);

        for (let tagDirFile of tagDirFiles) {
          // 仕分けルールでループ
          for (let type of assortRule) {
            const { fileExt, fileType } = type;

            // ファイルタイプ毎に合致するサブディレクトリに移動
            if (path.extname(tagDirFile) === fileExt) {
              const fromFile = path.join(tagDir, tagDirFile);
              const toDir = path.join(tagDir, fileType);
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

  console.info(finMsg);
};

export { fileOrganize };
