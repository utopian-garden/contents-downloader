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
    otherTable1:  appConfig.db.tab.artTable,
    otherTable2:  appConfig.db.tab.stuTable,
    priorQueUrl:  appConfig.mq.url.priorDlQueUrl
  });

  // Download Image Demote
  params.push({
    targetDir:    appConfig.fs.dlImageNgDir,
    oppoDir:      appConfig.fs.dlImageOkDir,
    fromTable:    appConfig.db.tab.dlTable,
    toTable:      appConfig.db.tab.igTable,
    otherTable1:  appConfig.db.tab.artTable,
    otherTable2:  appConfig.db.tab.stuTable,
    priorQueUrl:  appConfig.mq.url.priorIgQueUrl
  });

  // Download Video Demote
  params.push({
    targetDir:    appConfig.fs.dlVideoNgDir,
    oppoDir:      appConfig.fs.dlVideoOkDir,
    fromTable:    appConfig.db.tab.dlTable,
    toTable:      appConfig.db.tab.igTable,
    otherTable1:  appConfig.db.tab.artTable,
    otherTable2:  appConfig.db.tab.stuTable,
    priorQueUrl:  appConfig.mq.url.priorIgQueUrl
  });

  // Artist Download
  params.push({
    targetDir:    appConfig.fs.artOkDir,
    oppoDir:      appConfig.fs.artNgDir,
    fromTable:    appConfig.db.tab.artTable,
    toTable:      appConfig.db.tab.dlTable,
    otherTable1:  appConfig.db.tab.igTable,
    otherTable2:  appConfig.db.tab.stuTable,
    priorQueUrl:  appConfig.mq.url.priorDlQueUrl
  });

  // Artist Ignore
  params.push({
    targetDir:    appConfig.fs.artNgDir,
    oppoDir:      appConfig.fs.artOkDir,
    fromTable:    appConfig.db.tab.artTable,
    toTable:      appConfig.db.tab.igTable,
    otherTable1:  appConfig.db.tab.dlTable,
    otherTable2:  appConfig.db.tab.stuTable,
    priorQueUrl:  appConfig.mq.url.priorIgQueUrl
  });

  // Studio Download
  params.push({
    targetDir:    appConfig.fs.stuOkDir,
    oppoDir:      appConfig.fs.stuNgDir,
    fromTable:    appConfig.db.tab.stuTable,
    toTable:      appConfig.db.tab.dlTable,
    otherTable1:  appConfig.db.tab.igTable,
    otherTable2:  appConfig.db.tab.artTable,
    priorQueUrl:  appConfig.mq.url.priorDlQueUrl
  });

  // Studio Ignore
  params.push({
    targetDir:    appConfig.fs.stuNgDir,
    oppoDir:      appConfig.fs.stuOkDir,
    fromTable:    appConfig.db.tab.stuTable,
    toTable:      appConfig.db.tab.igTable,
    otherTable1:  appConfig.db.tab.dlTable,
    otherTable2:  appConfig.db.tab.artTable,
    priorQueUrl:  appConfig.mq.url.priorIgQueUrl
  });

  const startMsg = appConfig.assign.msg.startMsg;
  console.info(startMsg);

  // 各パターンに対する処理のループ
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

    const otherTable1 = param.otherTable1;
    let otherItems1 = [];
    try {
      otherItems1 = await ddb.scanAll(otherTable1);
    } catch(err) {
      throw err;
    }

    let otherItemTags1 = [];
    for (let otherItem1 of otherItems1) {
      otherItemTags1.push(otherItem1.tag);
    }

    const otherTable2 = param.otherTable2;
    let otherItems2 = [];
    try {
      otherItems2 = await ddb.scanAll(otherTable2);
    } catch(err) {
      throw err;
    }

    let otherItemTags2 = [];
    for (let otherItem2 of otherItems2) {
      otherItemTags2.push(otherItem2.tag);
    }

    // 各タグフォルダに対する処理のループ
    const targetDir = param.targetDir;
    const oppoDir = param.oppoDir;
    const targetTags = fs.readdirSync(targetDir);
    const chanSearchUrl = appConfig.req.search.chanSearchUrl;
    const chanSearchParam = appConfig.req.search.chanSearchParam;
    for (let targetTag of targetTags) {
      const targetTagDir = path.join(targetDir, targetTag);
      const oppoTagDir = path.join(oppoDir, targetTag);

      // タグがテーブルに存在するか確認 (末尾 '.' の補正つき)
      let fixedTargetTag;
      if (fromItemTags.includes(targetTag) ||
          toItemTags.includes(targetTag) ||
          otherItemTags1.includes(targetTag) ||
          otherItemTags2.includes(targetTag)) {

        fixedTargetTag = targetTag;
      } else if (fromItemTags.includes(targetTag + '.') ||
          toItemTags.includes(targetTag + '.') ||
          otherItemTags1.includes(targetTag + '.') ||
          otherItemTags2.includes(targetTag + '.')) {

        fixedTargetTag = targetTag + '.';
      }

      // 存在する場合
      if (fixedTargetTag) {
        try {
          // DB レコードの移動
          const toTable = param.toTable;
          await ddb.addItem(toTable, fixedTargetTag);
          await ddb.deleteItem(fromTable, fixedTargetTag);
          await ddb.deleteItem(otherTable1, fixedTargetTag);
          await ddb.deleteItem(otherTable2, fixedTargetTag);

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
      } else {
        logger.debug(toTable, chanSearchUrl + targetTag + chanSearchParam,
            path.join(targetDir, targetTag));
      }
    }

    // 対向の (上記で処理しない側、ファイルを残す側) の各タグフォルダに対するループ
    const oppoTags = fs.readdirSync(oppoDir);
    for (let oppoTag of oppoTags) {
      // テーブルまたは対向のテーブルに存在するか確認
      let fixedOppoTag;
      let wrongOppoTag;
      if (fromItemTags.includes(oppoTag)) {
        fixedOppoTag = oppoTag;
      } else if (fromItemTags.includes(oppoTag + '.')) {
        fixedOppoTag = oppoTag + '.';
      } else if (toItemTags.includes(oppoTag) ||
          otherItemTags1.includes(oppoTag) ||
          otherItemTags2.includes(oppoTag)) {

        wrongOppoTag = oppoTag;
      } else if (toItemTags.includes(oppoTag + '.') ||
          otherItemTags1.includes(oppoTag + '.') ||
          otherItemTags2.includes(oppoTag + '.')) {

        wrongOppoTag = oppoTag + '.';
      }

      if (wrongOppoTag) {
        // 対向のテーブルに存在する場合は補正する
        await ddb.addItem(fromTable, wrongOppoTag);
        await ddb.deleteItem(toTable, wrongOppoTag);
        await ddb.deleteItem(otherTable1, wrongOppoTag);
        await ddb.deleteItem(otherTable2, wrongOppoTag);
      } else if (!fixedOppoTag) {
        // テーブルに存在しない場合はタグをログに出力
        // (例えば image/_ok/ にフォルダが存在するのに Download テーブルにはタグがない等)
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
