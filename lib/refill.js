// 依存パッケージ
import consoleStamp from 'console-stamp-color';

consoleStamp(console, {
  format: ':date(yyyy/mm/dd HH:MM:ss.l) :label'
});

// ライブラリ
import correct from './correct.js';
import ddb from './ddb.js';
import sqs from './sqs.js';

// 設定ファイル
import appConfig from '../config/app-config.json' assert { type: 'json' };

// 定義
const msg = appConfig.mq.msg;
const queUrl = appConfig.mq.url;
const tab = appConfig.db.tab;

// MQ のメッセージ補充
const mqRefill = async (queType) => {
  // DB の重複修正
  correct.dupCorrect();

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
  tabItems = await ddb.scanAll(tabName);

  // スキャン結果でループしてメッセージを送信
  console.info(msg.startMsg + queType);

  for (let item of tabItems) {
    const msgBody = JSON.stringify(item);
    await sqs.sendMsg(targetQueUrl, msgBody);
  }

  console.info(msg.finMsg + queType);
};

const refill = { mqRefill };
export default refill;
