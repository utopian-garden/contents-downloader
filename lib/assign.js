'use strict';

// 依存パッケージ
const fs = require('fs-extra');
const log4js = require('log4js');
const path = require('path');
require('console-stamp-color')(console, {
  format: ':date(yyyy/mm/dd HH:MM:ss.l) :label'
});

// ライブラリ
const ddb = require('./ddb');
const sqs = require('./sqs');
const dbCorrect = require('./correct');

// 設定ファイル
const appConfig = require('../config/app-config.json');

// 初期化
const logger = log4js.getLogger('system');

exports.tagAssign = async () => {
  // 各フォルダ処理のパラメータ設定
  let params = [];

  // Ignore Promote
  params.push({
    targetDir:    appConfig.fs.igOkDir,
    oppoDir:      appConfig.fs.igNgDir,
    fromTable:    appConfig.db.tab.igTable,
    toTable:      appConfig.db.tab.dlTable,
    priorQueUrl:  appConfig.mq.url.priorDlQueUrl
  });

  // Download Image Demote
  params.push({
    targetDir:    appConfig.fs.dlImageNgDir,
    oppoDir:      appConfig.fs.dlImageOkDir,
    fromTable:    appConfig.db.tab.dlTable,
    toTable:      appConfig.db.tab.igTable,
    priorQueUrl:  appConfig.mq.url.priorIgQueUrl
  });

  // Download Video Demote
  params.push({
    targetDir:    appConfig.fs.dlVideoNgDir,
    oppoDir:      appConfig.fs.dlVideoOkDir,
    fromTable:    appConfig.db.tab.dlTable,
    toTable:      appConfig.db.tab.igTable,
    priorQueUrl:  appConfig.mq.url.priorIgQueUrl
  });

  // Artist Download
  params.push({
    targetDir:    appConfig.fs.artOkDir,
    oppoDir:      appConfig.fs.artNgDir,
    fromTable:    appConfig.db.tab.artTable,
    toTable:      appConfig.db.tab.dlTable,
    priorQueUrl:  appConfig.mq.url.priorDlQueUrl
  });

  // Artist Ignore
  params.push({
    targetDir:    appConfig.fs.artNgDir,
    oppoDir:      appConfig.fs.artOkDir,
    fromTable:    appConfig.db.tab.artTable,
    toTable:      appConfig.db.tab.igTable,
    priorQueUrl:  appConfig.mq.url.priorIgQueUrl
  });

  // Studio Download
  params.push({
    targetDir:    appConfig.fs.stuOkDir,
    oppoDir:      appConfig.fs.stuNgDir,
    fromTable:    appConfig.db.tab.stuTable,
    toTable:      appConfig.db.tab.dlTable,
    priorQueUrl:  appConfig.mq.url.priorDlQueUrl
  });

  // Studio Ignore
  params.push({
    targetDir:    appConfig.fs.stuNgDir,
    oppoDir:      appConfig.fs.stuOkDir,
    fromTable:    appConfig.db.tab.stuTable,
    toTable:      appConfig.db.tab.igTable,
    priorQueUrl:  appConfig.mq.url.priorIgQueUrl
  });

  const startMsg = appConfig.assign.msg.startMsg;
  console.info(startMsg);

  // 各フォルダに対する処理のループ
  for (let param of params) {
    // 既存 テーブルスキャン
    const fromTable = param.fromTable;
    let fromItems = [];
    try {
      fromItems = await ddb.scanAll(fromTable);
    } catch(err) {
      throw err;
    }

    let fromItemTags = [];
    for (let fromItem of fromItems) {
      fromItemTags.push(fromItem.tag);
    }

    const toTable = param.toTable;
    let toItems = [];
    try {
      toItems = await ddb.scanAll(toTable);
    } catch(err) {
      throw err;
    }

    let toItemTags = [];
    for (let toItem of toItems) {
      toItemTags.push(toItem.tag);
    }

    // 各タグフォルダに対する処理のループ
    const targetDir = param.targetDir;
    const oppoDir = param.oppoDir;
    const targetTags = fs.readdirSync(targetDir);
    for (let targetTag of targetTags) {
      const targetTagDir = path.join(targetDir, targetTag);
      const oppoTagDir = path.join(oppoDir, targetTag);

      // タグがテーブルに存在するか確認 (末尾 '.' の補正つき)
      let fixedTargetTag;
      if (fromItemTags.includes(targetTag) || toItemTags.includes(targetTag)) {
        fixedTargetTag = targetTag;
      } else if (fromItemTags.includes(targetTag + '.') ||
          toItemTags.includes(targetTag + '.')) {

        fixedTargetTag = targetTag + '.';
      }

      // 存在する場合
      if (fixedTargetTag) {
        try {
          // DB レコードの移動
          const toTable = param.toTable;
          await ddb.addItem(toTable, fixedTargetTag);
          await ddb.deleteItem(fromTable, fixedTargetTag);

          // サブフォルダの削除
          fs.removeSync(targetTagDir);
          fs.removeSync(oppoTagDir);

          // MQ のリクエストキューにメッセージを送信
          const priorQueUrl = param.priorQueUrl;
          const msgBody = JSON.stringify({"tag": targetTag, "last": "0"});
          await sqs.sendMsg(priorQueUrl, msgBody);
        } catch(err) {
          throw err;
        }
      }
    }

    // 対向の (上記で処理しない側、ファイルを残す側) の各タグフォルダが
    // テーブルに存在するかを確認し、存在しない場合はタグをログに出力
    // (例えば image/_ok にフォルダが存在するのに Download テーブルにはタグがない等)
    const oppoTags = fs.readdirSync(oppoDir);
    for (let oppoTag of oppoTags) {
      let fixedOppoTag;
      if (fromItemTags.includes(oppoTag)) {
        fixedOppoTag = oppoTag;
      } else if (fromItemTags.includes(oppoTag + '.')) {
        fixedOppoTag = oppoTag + '.';
      }

      if (!fixedOppoTag) {
        const chanSearchUrl = appConfig.req.search.chanSearchUrl;
        const chanSearchParam = appConfig.req.search.chanSearchParam;
        logger.debug(fromTable, chanSearchUrl + oppoTag + chanSearchParam,
            path.join(oppoDir, oppoTag));
      }
    }
  }

  // DB の重複修正
  dbCorrect.dupCorrect();

  const finMsg = appConfig.assign.msg.finMsg;
  console.info(finMsg);
}
