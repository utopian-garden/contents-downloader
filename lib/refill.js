// 依存パッケージ
import consoleStamp from 'console-stamp-color';

consoleStamp(console, {
  format: ':date(yyyy/mm/dd HH:MM:ss.l) :label'
});

// ライブラリ
import { dupCorrect } from './correct.js';
import { scanAll } from './ddb.js';
import { sendMsg } from './sqs.js';

// 設定ファイル
import appConfig from '../config/app-config.json' with { type: 'json' };

// 定義
const { startMsg, finMsg } = appConfig.mq.msg;
const { dlQueUrl, igQueUrl } = appConfig.mq.url;
const { dlTable, igTable } = appConfig.db.tab;

// MQ のメッセージ補充
const mqRefill = async (queType) => {
  // DB の重複修正
  dupCorrect();

  let tabName;
  let targetQueUrl;

  // 引数を基にパラメータを設定
  switch (queType) {
    case dlTable:
      tabName = dlTable;
      targetQueUrl = dlQueUrl;
      break;
    case igTable:
      tabName = igTable;
      targetQueUrl = igQueUrl;
      break;
  }

  // DB スキャン
  let tabItems = [];
  tabItems = await scanAll(tabName);

  // スキャン結果でループしてメッセージを送信
  console.info(startMsg + queType);

  for (let item of tabItems) {
    const msgBody = JSON.stringify(item);
    await sendMsg(targetQueUrl, msgBody);
  }

  console.info(finMsg + queType);
};

export { mqRefill };
