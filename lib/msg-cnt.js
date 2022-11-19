'use strict';

// ライブラリ
const sqs = require('./sqs');

// 設定ファイル
const appConfig = require('../config/app-config.json');

exports.msgCnt = async () => {
  const queueUrls = appConfig.mq.url;

  // 定義された各キューのメッセージ数を取得して表示
  for (let queue in queueUrls) {
    const queueCnt = await sqs.cntMsg(queueUrls[queue]);
    console.log(queue + ':', queueCnt);
  }
}

exports.msgCnt();
