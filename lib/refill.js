'use strict';

// 依存パッケージ
require('console-stamp-color')(console, {
  format: ':date(yyyy/mm/dd HH:MM:ss.l) :label'
});

// ライブラリ
const dbCorrect = require('./correct');
const ddb = require('./ddb');
const sqs = require('./sqs');

// 設定ファイル
const appConfig = require('../config/app-config.json');

// 定義
const msg = appConfig.mq.msg;
const queUrl = appConfig.mq.url;
const tab = appConfig.db.tab;

// MQ のメッセージ補充
exports.mqRefill = async (queType) => {
  // DB の重複修正
  dbCorrect.dupCorrect();

  let tabName;
  let targetQueUrl;

  // 引数を基にパラメータを設定
  switch (queType) {
    case tab.dlTable:
      tabName = tab.dlTable;
      targetQueUrl = queUrl.dlQueUrl;
      break;
    case tab.igTable:
      tabName = tab.igTable;
      targetQueUrl = queUrl.igQueUrl;
      break;
    case tab.artTable:
      tabName = tab.artTable;
      targetQueUrl = queUrl.artQueUrl;
      break;
    case tab.stuTable:
      tabName = tab.stuTable;
      targetQueUrl = queUrl.stuQueUrl;
      break;
  }

  // DB スキャン
  let tabItems = [];
  try {
    tabItems = await ddb.scanAll(tabName);
  } catch (err) {
    throw err;
  }

  // スキャン結果でループしてメッセージを送信
  console.info(msg.startMsg + queType);

  for (let item of tabItems) {
    const msgBody = JSON.stringify(item);
    await sqs.sendMsg(targetQueUrl, msgBody);
  }

  console.info(msg.finMsg + queType);
}
