'use strict';

// 依存パッケージ
require('console-stamp-color')(console, {
  format: ':date(yyyy/mm/dd HH:MM:ss.l) :label'
});

// ライブラリ
const ddb = require('./ddb');

// 設定ファイル
const appConfig = require('../config/app-config.json');

// 定義
const tab = appConfig.db.tab;

// DB修正
exports.dupCorrect = async () => {
  // Download のスキャン
  const dlItems = await ddb.scanAll(tab.dlTable);
  const dlTags = dlItems.map(item => { return item.tag });

  // Ignore のスキャン
  const igItems = await ddb.scanAll(tab.igTable);
  const igTags = igItems.map(item => { return item.tag });

  // Artist のスキャン
  const artItems = await ddb.scanAll(tab.artTable);
  const artTags = artItems.map(item => { return item.tag });

  // Studio のスキャン
  const stuItems = await ddb.scanAll(tab.stuTable);
  const stuTags = stuItems.map(item => { return item.tag });

  // 内容比較で重複があった場合はテーブルから削除
  for (let dlTag of dlTags) {
    // DL タグが Ignore テーブルにある場合は削除
    if (igTags.includes(dlTag)) {
      try {
        await ddb.deleteItem(tab.igTable, dlTag);
      } catch (err) {
        throw err;
      }
    }

    // DL タグが Artist テーブルにある場合は削除
    if (artTags.includes(dlTag)) {
      try {
        await ddb.deleteItem(tab.artTable, dlTag);
      } catch (err) {
        throw err;
      }
    }

    // DL タグが Studio テーブルにある場合は削除
    if (stuTags.includes(dlTag)) {
      try {
        await ddb.deleteItem(tab.stuTable, dlTag);
      } catch (err) {
        throw err;
      }
    }
  }

  for (let igItem of igItems) {
    // Ignore タグが Artist テーブルにある場合は削除
    if (artTags.includes(igItem.tag)) {
      try {
        await ddb.deleteItem(tab.artTable, igItem.tag);
      } catch (err) {
        throw err;
      }
    }

    // Ignore タグが Studio テーブルにある場合は削除
    if (stuTags.includes(igItem.tag)) {
      try {
        await ddb.deleteItem(tab.stuTable, igItem.tag);
      } catch (err) {
        throw err;
      }
    }
  }
}
