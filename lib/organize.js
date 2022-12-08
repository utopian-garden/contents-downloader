'use strict';

// 依存パッケージ
const fs = require('fs-extra');
const path = require('path');
const sanitize = require('sanitize-filename');
require('console-stamp-color')(console, {
  format: ':date(yyyy/mm/dd HH:MM:ss.l) :label'
});

// ライブラリ
const ddb = require('./ddb');
const walk = require('./walk');

// 設定ファイル
const appConfig = require('../config/app-config.json');

// 定義
const tab = appConfig.db.tab;
const msg = appConfig.organize.msg;
const dir = appConfig.fs.dir;
const organize = appConfig.organize;

// ファイルの仕分け
exports.fileOrganize = async () => {
  // DB スキャン
  let tagItems = [];
  try {
    tagItems = await ddb.scanAll(tab.dlTable);
  } catch(err) {
    throw err;
  }

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
      if (tagSubDirFiles.length > organize.fileThre) {
        // ファイル名でループ
        const tagDirFiles = fs.readdirSync(tagDir);
        for (let tagDirFile of tagDirFiles) {
          // 仕分けルールでループ
          for (let type of organize.assortRule) {
            // ファイルタイプ毎に合致するサブディレクトリに移動
            if (path.extname(tagDirFile) === type.fileExt) {
              const fromFile = path.join(tagDir, tagDirFile);
              const toDir = path.join(tagDir, type.fileType);
              const toFile = path.join(toDir, tagDirFile);
              fs.ensureDirSync(toDir);
              fs.moveSync(fromFile , toFile);
              break;
            }
          }
        }
      }
    }
  }

  console.info(msg.finMsg);
}
