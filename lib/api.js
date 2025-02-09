// 依存パッケージ
import consoleStamp from 'console-stamp-color';
import express from 'express';
import fs from 'fs-extra';
import log4js from 'log4js';
import path from 'path';
import sanitize from 'sanitize-filename';

consoleStamp(console, {
  format: ':date(yyyy/mm/dd HH:MM:ss.l) :label'
});

// ライブラリ
import assign from './assign.js';
import ddb from './ddb.js';
import organize from './organize.js';
import refill from './refill.js';
import sqs from './sqs.js';

// 設定ファイル
import appConfig from '../config/app-config.json' with { type: 'json' };

// 初期化
log4js.configure('./config/api-log-config.json');
const logger = log4js.getLogger('system');
const app = express();
app.use(express.urlencoded({
  extended: true
}));
app.use(express.json());

// 定義
const apiUri = appConfig.api.uri;
const dir = appConfig.fs.dir;
const msg = appConfig.api.msg;
const queUrl = appConfig.mq.url;
const tab = appConfig.db.tab;

// Chrome の CORS 回避
app.options('/', async (req, res) => {
  res
    .set({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST',
      'Access-Control-Allow-Headers': 'content-type'
    })
    .send();
});

// check db
app.get(apiUri['chkDbUri'], async (req, res) => {
  const reqQuery = req.query;

  const reqTag = reqQuery.tag;
  try {
    // Download と Ignore から tag が一致する item を取得
    const dlItems = await ddb.getItem(tab.dlTable, reqTag);
    const igItems = await ddb.getItem(tab.igTable, reqTag);
    const artItems = await ddb.getItem(tab.artTable, reqTag);
    const stuItems = await ddb.getItem(tab.stuTable, reqTag);
    let resTable;

    // item が入っている DB を判定
    if (dlItems.Item) {
      resTable = tab.dlTable;
    } else if (igItems.Item) {
      resTable = tab.igTable;
    } else if (artItems.Item) {
      resTable = tab.artTable;
    } else if (stuItems.Item) {
      resTable = tab.stuTable;
    } else {
      resTable = 'None';
    }

    // 判定結果を返す
    res
      .set({
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json;charset=utf-8'
      })
      .send(JSON.stringify({
        success: true, table: resTable, tag: reqTag
      }));
  } catch (err) {
    // エラーを返す
    logger.error('chkDbUri', err.message);

    res
      .status(500)
      .set({
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json;charset=utf-8'
      })
      .send(JSON.stringify({
        success: false, tag: reqTag
      }));
  }
});

// add item
app.post(apiUri['addItemUri'], async (req, res) => {
  const reqBody = req.body;

  const reqTable = reqBody.table;
  const reqTag = reqBody.tag;
  const saniReqTag = sanitize(reqTag);
  let oppTable;
  let msgBody;

  const dlImageTagDir = path.join(dir.dlImageDir, saniReqTag);
  const dlImageOkTagDir = path.join(dir.dlImageOkDir, saniReqTag);
  const dlImageNgTagDir = path.join(dir.dlImageNgDir, saniReqTag);
  const dlVideoTagDir = path.join(dir.dlVideoDir, saniReqTag);
  const dlVideoOkTagDir = path.join(dir.dlVideoOkDir, saniReqTag);
  const dlVideoNgTagDir = path.join(dir.dlVideoNgDir, saniReqTag);

  const igTagDir = path.join(dir.igDir, saniReqTag);
  const igNgTagDir = path.join(dir.igNgDir, saniReqTag);

  console.log(reqTag);

  // 入力チェック
  switch (reqTable) {
    // Ignore の場合
    case tab.igTable:
      oppTable = tab.dlTable;
      try {
        // Ignore テーブルへの追加と Download テーブルからの削除
        await ddb.addItem(reqTable, reqTag);
        await ddb.deleteItem(oppTable, reqTag);
        await ddb.deleteItem(tab.artTable, reqTag);
        await ddb.deleteItem(tab.stuTable, reqTag);

        res.
          set({
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/json;charset=utf-8'
          }).
          send(JSON.stringify({
            success: true, table: reqTable, tag: reqTag
          }));
      } catch (err) {
        logger.error('addItemUri', err.message);

        res.
          status(500).
          set({
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/json;charset=utf-8'
          }).
          send(JSON.stringify({
            success: false, tag: reqTag
          }));
      }

      // MQ のリクエストキューにメッセージを送信
      try {
        msgBody = JSON.stringify({ tag: reqTag, last: '0' });
        await sqs.sendMsg(queUrl.priorIgQueUrl, msgBody);
      } catch (err) {
        logger.error('sendMsg (priorIgQueUrl):', err.message);
      }

      // Ignore に登録する場合は既存の DL フォルダを削除
      if (saniReqTag) {
        try {
          fs.removeSync(dlImageTagDir);
          fs.removeSync(dlImageOkTagDir);
          fs.removeSync(dlImageNgTagDir);
          fs.removeSync(dlVideoTagDir);
          fs.removeSync(dlVideoOkTagDir);
          fs.removeSync(dlVideoNgTagDir);
        } catch (err) {
          logger.error('addItemUri', err.message);
        }
      }

      break;

    // Download の場合
    case tab.dlTable:
      oppTable = tab.igTable;
      try {
        // Download テーブルへの追加と Ignore テーブルからの削除
        await ddb.addItem(reqTable, reqTag);
        await ddb.deleteItem(oppTable, reqTag);
        await ddb.deleteItem(tab.artTable, reqTag);
        await ddb.deleteItem(tab.stuTable, reqTag);

        res.
          set({
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/json;charset=utf-8'
          }).
          send(JSON.stringify({
            success: true, table: reqTable, tag: reqTag
          }));
      } catch (err) {
        logger.error('addItemUri', err.message);

        res.
          status(500).
          set({
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/json;charset=utf-8'
          }).
          send(JSON.stringify({
            success: false, tag: reqTag
          }));
      }

      // MQ のリクエストキューにメッセージを送信
      try {
        msgBody = JSON.stringify({ tag: reqTag, last: '0' });
        await sqs.sendMsg(queUrl.priorDlQueUrl, msgBody);
      } catch (err) {
        logger.error('sendMsg (priorDlQueUrl):', err.$response);
      }

      // Download に登録する場合は既存の Ignore フォルダを削除
      if (saniReqTag) {
        try {
          fs.removeSync(igTagDir);
          fs.removeSync(igNgTagDir);
        } catch (err) {
          logger.error('addItemUri', err.message);
        }
      }

      break;

    case tab.artTable:
      res.
        set({
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json;charset=utf-8'
        }).
        send(JSON.stringify({
          success: true, table: reqTable, tag: reqTag
        }));

      // MQ のリクエストキューにメッセージを送信
      try {
        msgBody = JSON.stringify({ tag: reqTag, last: '0' });
        await sqs.sendMsg(queUrl.priorArtQueUrl, msgBody);
      } catch (err) {
        logger.error('sendMsg (priorArtQueUrl):', err.message);
      }

      break;

    case tab.stuTable:
      res.
        set({
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json;charset=utf-8'
        }).
        send(JSON.stringify({
          success: true, table: reqTable, tag: reqTag
        }));

      // MQ のリクエストキューにメッセージを送信
      try {
        msgBody = JSON.stringify({ tag: reqTag, last: '0' });
        await sqs.sendMsg(queUrl.priorStudioQueUrl, msgBody);
      } catch (err) {
        logger.error('sendMsg (priorStudioQueUrl):', err.message);
      }

      break;
  }
});

// refill
app.post(apiUri['refillUri'], async (req, res) => {
  const reqBody = req.body;

  const reqTable = reqBody.table;
  try {
    // 対象のリクエストキューに refill を実行
    await refill.mqRefill(reqTable);
  } catch (err) {
    logger.error('refillUri', err.message);
  }

  res.
    set({
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json;charset=utf-8'
    }).
    send(JSON.stringify({
      accept: true, table: reqTable
    }));

});

// assign
app.post(apiUri['assignUri'], async (req, res) => {
  try {
    // assign を実行
    await assign.tagAssign();
  } catch (err) {
    logger.error('assignUri', err.message);
  }

  res.
    set({
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json;charset=utf-8'
    }).
    send(JSON.stringify({
      accept: true
    }));
});

// organize
app.post(apiUri['organizeUri'], async (req, res) => {
  try {
    // organize を実行
    await organize.fileOrganize();
  } catch (err) {
    logger.error('organizeUri', err.message);
  }

  res.
    set({
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json;charset=utf-8'
    }).
    send(JSON.stringify({
      accept: true
    }));
});

// get link
app.post(apiUri['getLinkUri'], async (req, res) => {
  const reqBody = req.body;

  // 受け取った url をログに出力
  const url = reqBody.url;
  fs.appendFileSync('log/torrent.txt', `${url}\n`);

  res.
    set({
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json;charset=utf-8'
    }).
    send(JSON.stringify({
      accept: true
    }));
});

// サーバ起動
app.listen(3000);

console.info(msg.startMsg);
