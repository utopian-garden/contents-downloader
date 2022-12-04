'use strict';

// 依存パッケージ
const express = require('express');
const fs = require('fs-extra');
const log4js = require('log4js');
const path = require('path');
const sanitize = require('sanitize-filename');
require('console-stamp-color')(console, {
  format: ':date(yyyy/mm/dd HH:MM:ss.l) :label'
});

// ライブラリ
const ddb = require('./ddb');
const organize = require('./organize');
const refill = require('./refill');
const sqs = require('./sqs');
const assign = require('./assign');

// 設定ファイル
const appConfig = require('../config/app-config.json');

// 初期化
log4js.configure('./config/api-log-config.json');
const logger = log4js.getLogger('system');
const app = express();
app.use(express.urlencoded({
  extended: true
}));
app.use(express.json());

// 設定
const dlTable = appConfig.db.tab.dlTable;
const igTable = appConfig.db.tab.igTable;
const artTable = appConfig.db.tab.artTable;
const stuTable = appConfig.db.tab.stuTable;

// Chrome の CORS 回避
app.options(async (req, res) => {
  res
    .set({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST',
      'Access-Control-Allow-Headers': 'content-type'
    })
    .send();
});

const apiUri = appConfig.api.uri;

// check db
app.get(apiUri['chkDbUri'], async (req, res) => {
  const reqQuery = req.query;

  const reqTag = reqQuery.tag;
  try {
    // Download と Ignore から tag が一致する item を取得
    const dlItems = await ddb.getItem(dlTable, reqTag);
    const igItems = await ddb.getItem(igTable, reqTag);
    const artItems = await ddb.getItem(artTable, reqTag);
    const stuItems = await ddb.getItem(stuTable, reqTag);
    let resTable;

    // item が入っている DB を判定
    if (dlItems.Item) {
      resTable = dlTable;
    } else if (igItems.Item) {
      resTable = igTable;
    } else if (artItems.Item) {
      resTable = artTable;
    } else if (stuItems.Item) {
      resTable = stuTable;
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
        'success': true, 'table': resTable, 'tag': reqTag
      }));
  } catch(err) {
    // エラーを返す
    logger.error('chkDbUri', err.message);

    res
      .status(500)
      .set({
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json;charset=utf-8'
      })
      .send(JSON.stringify({
        'success': false, 'tag': reqTag
      }));
  }
})

// add item
app.post(apiUri['addItemUri'], async (req, res) => {
  const reqBody = req.body;

  const reqTable = reqBody.table;
  const reqTag = reqBody.tag;
  const saniReqTag = sanitize(reqTag);
  let oppTable;
  let msgBody;

  // 入力チェック
  switch (reqTable) {
    // Ignore の場合
    case igTable:
      oppTable = dlTable;
      try {
        // Ignore テーブルへの追加と Download テーブルからの削除
        await ddb.addItem(reqTable, reqTag);
        await ddb.deleteItem(oppTable, reqTag);
        await ddb.deleteItem(artTable, reqTag);
        await ddb.deleteItem(stuTable, reqTag);

        res
          .set({
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/json;charset=utf-8'
          })
          .send(JSON.stringify({
            'success': true, 'table': reqTable, 'tag': reqTag
          }));
      } catch(err) {
        logger.error('addItemUri', err.message);

        res
          .status(500)
          .set({
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/json;charset=utf-8'
          })
          .send(JSON.stringify({
            'success': false, 'tag': reqTag
          }));
      }

      // MQ のリクエストキューにメッセージを送信
      const priorIgQueUrl = appConfig.mq.url.priorIgQueUrl;
      msgBody = JSON.stringify({"tag": reqTag, "last": "0"});
      await sqs.sendMsg(priorIgQueUrl, msgBody);

      // Ignore に登録する場合は既存の DL フォルダを削除
      const dlImageDir = appConfig.fs.dlImageDir;
      const dlImageOkDir = appConfig.fs.dlImageOkDir;
      const dlImageNgDir = appConfig.fs.dlImageNgDir;
      const dlVideoDir = appConfig.fs.dlVideoDir;
      const dlVideoOkDir = appConfig.fs.dlVideoOkDir;
      const dlVideoNgDir = appConfig.fs.dlVideoNgDir;

      const tagImageDir = path.join(dlImageDir, saniReqTag);
      const tagImageOkDir = path.join(dlImageOkDir, saniReqTag);
      const tagImageNgDir = path.join(dlImageNgDir, saniReqTag);
      const tagVideoDir = path.join(dlVideoDir, saniReqTag);
      const tagVideoOkDir = path.join(dlVideoOkDir, saniReqTag);
      const tagVideoNgDir = path.join(dlVideoNgDir, saniReqTag);

      if (saniReqTag) {
        try {
          fs.removeSync(tagImageDir);
          fs.removeSync(tagImageOkDir);
          fs.removeSync(tagImageNgDir);
          fs.removeSync(tagVideoDir);
          fs.removeSync(tagVideoOkDir);
          fs.removeSync(tagVideoNgDir);
        } catch(err) {
          logger.error('addItemUri', err.message);
        }
      }

      break;

    // Download の場合
    case dlTable:
      oppTable = igTable;
      try {
        // Download テーブルへの追加と Ignore テーブルからの削除
        await ddb.addItem(reqTable, reqTag);
        await ddb.deleteItem(oppTable, reqTag);
        await ddb.deleteItem(artTable, reqTag);
        await ddb.deleteItem(stuTable, reqTag);

        res
          .set({
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/json;charset=utf-8'
          })
          .send(JSON.stringify({
            'success': true, 'table': reqTable, 'tag': reqTag
          }));
      } catch(err) {
        logger.error('addItemUri', err.message);

        res
          .status(500)
          .set({
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/json;charset=utf-8'
          })
          .send(JSON.stringify({
            'success': false, 'tag': reqTag
          }));
      }

      // MQ のリクエストキューにメッセージを送信
      const priorDlQueUrl = appConfig.mq.url.priorDlQueUrl;
      msgBody = JSON.stringify({"tag": reqTag, "last": "0"});
      await sqs.sendMsg(priorDlQueUrl, msgBody);

      // Download に登録する場合は既存の Ignore フォルダを削除
      const igDir = path.join(appConfig.fs.igDir, saniReqTag);
      const igNgDir = path.join(appConfig.fs.igNgDir, saniReqTag);

      if (saniReqTag) {
        try {
          fs.removeSync(igDir);
          fs.removeSync(igNgDir);
        } catch(err) {
          logger.error('addItemUri', err.message);
        }
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
  } catch(err) {
    logger.error('refillUri', err.message);
  }

  res
    .set({
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json;charset=utf-8'
    })
    .send(JSON.stringify({
      'accept': true, 'table': reqTable
    }));

});

// assign
app.post(apiUri['assignUri'], async (req, res) => {
  try {
    // assign を実行
    await assign.tagAssign();
  } catch(err) {
    logger.error('assignUri', err.message);
  }

  res
    .set({
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json;charset=utf-8'
    })
    .send(JSON.stringify({
      'accept': true
    }));
});

// organize
app.post(apiUri['organizeUri'], async (req, res) => {
  try {
    // organize を実行
    await organize.fileOrganize();
  } catch(err) {
    logger.error('organizeUri', err.message);
  }

  res
    .set({
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json;charset=utf-8'
    })
    .send(JSON.stringify({
      'accept': true
    }));
});

// get link
app.post(apiUri['getLinkUri'], async (req, res) => {
  const reqBody = req.body;

  // 受け取った url をログに出力
  const url = reqBody.url;
  logger.debug(url);

  res
    .set({
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json;charset=utf-8'
    })
    .send(JSON.stringify({
      'accept': true
    }));
});

// サーバ起動
app.listen(3000);

const startMsg = appConfig.api.msg.startMsg;
console.info(startMsg);
