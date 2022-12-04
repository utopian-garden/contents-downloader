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
    console.info(queue + ':', queueCnt);
  }

  const middlePoll = appConfig.req.poll.middlePoll;
  await waitTimer(middlePoll);
}

// Wait 処理
const waitTimer = (quePoll) => {
  return new Promise((resolve, reject) => {
    setTimeout(resolve, quePoll * 1000);
  });
};

exports.msgCnt();
