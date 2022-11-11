'use strict';

// 依存パッケージ
require('console-stamp-color')(console, {
  format: ':date(yyyy/mm/dd HH:MM:ss.l) :label'
});

// ライブラリ
const ddb = require('./ddb');

// 設定ファイル
const appConfig = require('../config/app-config.json');

// タグの DB レコードインポート
exports.dbMigrate = async() => {
  const igTable = appConfig.db.tab.igTable;

  // 既存 テーブルスキャン
  let fromItems = [];
  try {
    fromItems = await ddb.scanAll('Favorite');
    console.log('read fav end')
  } catch(err) {
    console.error('scanAll', err);
    throw err;
  }

  let toItems = [];
  try {
    toItems = await ddb.scanAll(igTable);
    console.log('read ig end')
  } catch(err) {
    console.error('scanAll', err);
    throw err;
  }

  let batchRequest = [];
  for (let fromItem of fromItems) {
    if (!toItems.includes(fromItem.tag)) {
      const tagObj = {
        PutRequest: {
          Item: { tag: fromItem.tag }
        }
      };
      batchRequest.push(tagObj);
      console.log(fromItem.tag);
    }
  }
  console.log('diff end')

  for (let i = 0; i < batchRequest.length; i = i + 25) {
    try {
      let reqSlice = batchRequest.slice(i, i + 24);
      if (reqSlice.length > 0) {
        await ddb.writeItems(igTable, reqSlice);
      }
    } catch(err) {
      console.error('ddbWrite', err.message);
    }
  }
  console.log('migrate end')
}

// メイン処理の起動
exports.dbMigrate();
