'use strict';

// 依存パッケージ
require('console-stamp-color')(console, {
  format: ':date(yyyy/mm/dd HH:MM:ss.l) :label'
});

// ライブラリ
const ddb = require('./ddb');

// 設定ファイル
const appConfig = require('../config/app-config.json');

// DB修正
exports.dupCorrect = async () => {
  // Download のスキャン
  const dlTable = appConfig.db.tab.dlTable;
  let dlItems = await ddb.scanAll(dlTable);

  // Ignore のスキャン
  const igTable = appConfig.db.tab.igTable;
  let igItems = await ddb.scanAll(igTable);
  let igTags = [];
  for (let igItem of igItems) {
    igTags.push(igItem.tag);
  }

  // 内容比較で重複があった場合は Ignore から削除
  for (let dlItem of dlItems) {
    if (igTags.includes(dlItem.tag)) {
      try {
        await ddb.deleteItem(igTable, dlItem.tag);
      } catch(err) {
        throw err;
      }
    }
  }
}
