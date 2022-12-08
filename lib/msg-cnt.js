'use strict';

// ライブラリ
const sqs = require('./sqs');

// 設定ファイル
const appConfig = require('../config/app-config.json');

// 定義
const queUrl = appConfig.mq.url;
const reqPoll = appConfig.req.poll

exports.msgCnt = async () => {
  // 定義された各キューのメッセージ数を取得して表示
  for (let queue in queUrl) {
    const queueCnt = await sqs.cntMsg(queUrl[queue]);
    console.info(queue + ':', queueCnt);
  }

  await waitTimer(reqPoll.middlePoll);
}

// Wait 処理
const waitTimer = (quePoll) => {
  return new Promise((resolve, reject) => {
    setTimeout(resolve, quePoll * 1000);
  });
};

exports.msgCnt();
