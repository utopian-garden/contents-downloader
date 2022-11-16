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

// Chrome の CORS 回避
app.options(async (req, res) => {
  res
    .set({
      'Access-Control-Allow-Origin':'*',
      'Access-Control-Allow-Methods':'GET,POST',
      'Access-Control-Allow-Headers':'content-type'
    })
    .send();
});

const apiUri = appConfig.api.uri;


app.get(apiUri['chkDbUri'], async (req, res) => {
  const reqQuery = req.query;
  const reqTag = reqQuery.tag;
  const tagAttr = appConfig.db.attr.tagAttr;
  try {
    const dlItems = await ddb.queryItem(dlTable, tagAttr, reqTag);
    const igItems = await ddb.queryItem(igTable, tagAttr, reqTag);
    let resTable;

    if (dlItems.Items.length > igItems.Items.length) {
      resTable = dlTable;
    } else if (igItems.Items.length > dlItems.Items.length) {
      resTable = igTable;
    } else {
      resTable = 'None';
    }

    res
      .set({
        'Access-Control-Allow-Origin':'*',
        'Content-Type': 'application/json;charset=utf-8'
      })
      .send(JSON.stringify({
        'success': true, 'table': resTable, 'tag': reqTag
      }));
  } catch(err) {
    console.error('chkDbUri', err.message);
    logger.error('chkDbUri', err.message);

    res
      .status(500)
      .set({
        'Access-Control-Allow-Origin':'*',
        'Content-Type': 'application/json;charset=utf-8'
      })
      .send(JSON.stringify({
        'success': false, 'tag': reqTag
      }));
  }
})


app.post(apiUri['addItemUri'], async (req, res) => {
  const reqBody = req.body;
  const reqTable = reqBody.table;
  const reqTag = reqBody.tag;
  let oppTable;
  let msgBody;

  // 入力チェック
  switch (reqTable) {
    // Ignore テーブルの更新と Download テーブルの削除
    case igTable:
      oppTable = dlTable;
      try {
        await ddb.addItem(reqTable, reqTag);
        await ddb.deleteItem(oppTable, reqTag);

        res
          .set({
            'Access-Control-Allow-Origin':'*',
            'Content-Type': 'application/json;charset=utf-8'
          })
          .send(JSON.stringify({
            'success': true, 'table': reqTable, 'tag': reqTag
          }));
      } catch(err) {
        console.error('addItemUri', err.message);
        logger.error('addItemUri', err.message);

        res
          .status(500)
          .set({
            'Access-Control-Allow-Origin':'*',
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
      const dlVideoDir = appConfig.fs.dlVideoDir;
      const dlVideoOkDir = appConfig.fs.dlVideoOkDir;

      const tagImageDir = path.join(dlImageDir, sanitize(reqTag));
      const tagImageOkDir = path.join(dlImageOkDir, sanitize(reqTag));
      const tagVideoDir = path.join(dlVideoDir, sanitize(reqTag));
      const tagVideoOkDir = path.join(dlVideoOkDir, sanitize(reqTag));

      try {
        fs.removeSync(tagImageDir);
        fs.removeSync(tagImageOkDir);
        fs.removeSync(tagVideoDir);
        fs.removeSync(tagVideoOkDir);
      } catch(err) {
        console.error('addItemUri', err.message);
        logger.error('addItemUri', err.message);
      }

      break;

    // Download テーブルの更新と Ignore テーブルの削除
    case dlTable:
      oppTable = igTable;
      try {
        await ddb.addItem(reqTable, reqTag);
        await ddb.deleteItem(oppTable, reqTag);

        res
          .set({
            'Access-Control-Allow-Origin':'*',
            'Content-Type': 'application/json;charset=utf-8'
          })
          .send(JSON.stringify({
            'success': true, 'table': reqTable, 'tag': reqTag
          }));
      } catch(err) {
        console.error('addItemUri', err.message);
        logger.error('addItemUri', err.message);

        res
          .status(500)
          .set({
            'Access-Control-Allow-Origin':'*',
            'Content-Type': 'application/json;charset=utf-8'
          })
          .send(JSON.stringify({
            'success': false, 'tag': reqTag
          }));
      }

      // MQ のリクエストキューにメッセージを送信
      const priorDlQueUrl = appConfig.mq.url.priorDlQueUrl;
      msgBody = JSON.stringify({"tag": reqTag, "last":"0"});
      await sqs.sendMsg(priorDlQueUrl, msgBody);

      // Download に登録する場合は既存の Ignore フォルダを削除
      const igDir = path.join(appConfig.fs.igDir, sanitize(reqTag));
      const igNgDir = path.join(appConfig.fs.igNgDir, sanitize(reqTag));
      try {
        fs.removeSync(igDir);
        fs.removeSync(igNgDir);
      } catch(err) {
        console.error('addItemUri', err.message);
        logger.error('addItemUri', err.message);
      }

      break;
  }
});


app.post(apiUri['refillUri'], async (req, res) => {
  const reqBody = req.body;
  const reqTable = reqBody.table;
  try {
    await refill.mqRefill(reqTable);
  } catch(err) {
    console.error('refillUri', err.message);
    logger.error('refillUri', err.message);
  }

  res
    .set({
      'Access-Control-Allow-Origin':'*',
      'Content-Type': 'application/json;charset=utf-8'
    })
    .send(JSON.stringify({
      'accept': true, 'table': reqTable
    }));

});


app.post(apiUri['assignUri'], async (req, res) => {
  const reqBody = req.body;

  try {
    await assign.tagAssign();
  } catch(err) {
    console.error('assignUri', err.message);
    logger.error('assignUri', err.message);
  }

  res
    .set({
      'Access-Control-Allow-Origin':'*',
      'Content-Type': 'application/json;charset=utf-8'
    })
    .send(JSON.stringify({
      'accept': true
    }));
});


app.post(apiUri['organizeUri'], async (req, res) => {
  try {
    await organize.fileOrganize();
  } catch(err) {
    console.error('organizeUri', err.message);
    logger.error('organizeUri', err.message);
  }

  res
    .set({
      'Access-Control-Allow-Origin':'*',
      'Content-Type': 'application/json;charset=utf-8'
    })
    .send(JSON.stringify({
      'accept': true
    }));
});


app.post(apiUri['getLinkUri'], async (req, res) => {
  const reqBody = req.body;
  const url = reqBody.url;
  logger.debug(url);

  res
    .set({
      'Access-Control-Allow-Origin':'*',
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
