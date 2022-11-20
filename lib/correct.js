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
  let dlTags = [];
  for (let dlItem of dlItems) {
    dlTags.push(dlItem.tag);
  }

  // Ignore のスキャン
  const igTable = appConfig.db.tab.igTable;
  let igItems = await ddb.scanAll(igTable);
  let igTags = [];
  for (let igItem of igItems) {
    igTags.push(igItem.tag);
  }

  // Artist のスキャン
  const artTable = appConfig.db.tab.artTable;
  let artItems = await ddb.scanAll(artTable);
  let artTags = [];
  for (let artItem of artItems) {
    artTags.push(artItem.tag);
  }

  // Studio のスキャン
  const stuTable = appConfig.db.tab.stuTable;
  let stuItems = await ddb.scanAll(stuTable);
  let stuTags = [];
  for (let stuItem of stuItems) {
    stuTags.push(stuItem.tag);
  }

  // 内容比較で重複があった場合はテーブルから削除
  for (let dlTag of dlTags) {
    // DL タグが Ignore テーブルにある場合は削除
    if (igTags.includes(dlTag)) {
      try {
        await ddb.deleteItem(igTable, dlTag);
      } catch(err) {
        throw err;
      }
    }

    // DL タグが Artist テーブルにある場合は削除
    if (artTags.includes(dlTag)) {
      try {
        await ddb.deleteItem(artTable, dlTag);
      } catch(err) {
        throw err;
      }
    }

    // DL タグが Studio テーブルにある場合は削除
    if (stuTags.includes(dlTag)) {
      try {
        await ddb.deleteItem(stuTable, dlTag);
      } catch(err) {
        throw err;
      }
    }
  }

  for (let igItem of igItems) {
    // Ignore タグが Artist テーブルにある場合は削除
    if (artTags.includes(igItem.tag)) {
      try {
        await ddb.deleteItem(artTable, igItem.tag);
      } catch(err) {
        throw err;
      }
    }

    // Ignore タグが Studio テーブルにある場合は削除
    if (stuTags.includes(igItem.tag)) {
      try {
        await ddb.deleteItem(stuTable, igItem.tag);
      } catch(err) {
        throw err;
      }
    }
  }
}
