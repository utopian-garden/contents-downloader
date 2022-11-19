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

// MQ のメッセージ補充
exports.mqRefill = async(queType) => {
  // DB の重複修正
  dbCorrect.dupCorrect();

  const dlTable = appConfig.db.tab.dlTable;
  const igTable = appConfig.db.tab.igTable;
  const artTable = appConfig.db.tab.artTable;
  const stuTable = appConfig.db.tab.stuTable;
  let tabName;
  let queUrl;

  // 引数を基にパラメータを設定
  switch (queType) {
    case dlTable:
      tabName = appConfig.db.tab.dlTable;
      queUrl = appConfig.mq.url.dlQueUrl;
      break;
    case igTable:
      tabName = appConfig.db.tab.igTable;
      queUrl = appConfig.mq.url.igQueUrl;
      break;
    case artTable:
      tabName = appConfig.db.tab.artTable;
      queUrl = appConfig.mq.url.artQueUrl;
      break;
    case stuTable:
      tabName = appConfig.db.tab.stuTable;
      queUrl = appConfig.mq.url.stuQueUrl;
      break;
  }

  // DB スキャン
  let tabItems = [];
  try {
    tabItems = await ddb.scanAll(tabName);
  } catch(err) {
    throw err;
  }

  // スキャン結果でループしてメッセージを送信
  const startMsg = appConfig.mq.msg.startMsg;
  console.info(startMsg + queType);

  for (let item of tabItems) {
    const msgBody = JSON.stringify(item);
    await sqs.sendMsg(queUrl, msgBody);
  }

  const finMsg = appConfig.mq.msg.finMsg;
  console.info(finMsg + queType);
}
