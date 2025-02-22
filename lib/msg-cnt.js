// ライブラリ
import { cntMsg } from './sqs.js';

// 設定ファイル
import appConfig from '../config/app-config.json' with { type: 'json' };

// 定義
const queUrl = appConfig.mq.url;
const { middlePoll } = appConfig.req.poll;

const msgCnt = async () => {
  // 定義された各キューのメッセージ数を取得して表示
  for (let [key, value] of Object.entries(queUrl)) {
    const queueCnt = await cntMsg(value);
    console.info(key + ':', queueCnt);
  }

  await waitTimer(middlePoll);
};

// Wait 処理
const waitTimer = (quePoll) => {
  return new Promise((resolve) => {
    setTimeout(resolve, quePoll * 1000);
  });
};

msgCnt();
