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
  // 各テーブルをスキャン
  const dlTab = appConfig.db.tab.dlTable;
  const dlItems = await ddb.scanAll(dlTab);
  const dlItemTags = dlItems.map(item => { return item.tag });

  const igTab = appConfig.db.tab.igTable;
  const igItems = await ddb.scanAll(igTab);
  const igItemTags = igItems.map(item => { return item.tag });

  const artTab = appConfig.db.tab.artTable;
  const artItems = await ddb.scanAll(artTab);
  const artItemTags = artItems.map(item => { return item.tag });

  const stuTab = appConfig.db.tab.stuTable;
  const stuItems = await ddb.scanAll(stuTab);
  const stuItemTags = stuItems.map(item => { return item.tag });

  // 各フォルダをスキャン
  const igOkDir = appConfig.fs.igOkDir;
  const igOkDirTag = fs.readdirSync(igOkDir);

  const igNgDir = appConfig.fs.igNgDir;
  const igNgDirTag = fs.readdirSync(igNgDir);

  const dlImageNgDir = appConfig.fs.dlImageNgDir;
  const dlImageNgDirTag = fs.readdirSync(dlImageNgDir);

  const dlImageOkDir = appConfig.fs.dlImageOkDir;
  const dlImageOkDirTag = fs.readdirSync(dlImageOkDir);

  const dlVideoNgDir = appConfig.fs.dlVideoNgDir;
  const dlVideoNgDirTag = fs.readdirSync(dlVideoNgDir);

  const dlVideoOkDir = appConfig.fs.dlVideoOkDir;
  const dlVideoOkDirTag = fs.readdirSync(dlVideoOkDir);

  const artOkDir = appConfig.fs.artOkDir;
  const artOkDirTag = fs.readdirSync(artOkDir);

  const artNgDir = appConfig.fs.artNgDir;
  const artNgDirTag = fs.readdirSync(artNgDir);

  const stuOkDir = appConfig.fs.stuOkDir;
  const stuOkDirTag = fs.readdirSync(stuOkDir);

  const stuNgDir = appConfig.fs.stuNgDir;
  const stuNgDirTag = fs.readdirSync(stuNgDir);

  // 各フォルダ処理のパラメータ設定
  let params = [];

  // Ignore Promote
  params.push({
    targetDir:      igOkDir,
    oppoDir:        igNgDir,
    targetDirTag:   igOkDirTag,
    oppoDirTag:     igNgDirTag,
    fromTable:      igTab,
    toTable:        dlTab,
    otherTable1:    artTab,
    otherTable2:    stuTab,
    fromItemTags:   igItemTags,
    toItemTags:     dlItemTags,
    otherItemTags1: artItemTags,
    otherItemTags2: stuItemTags,
    priorQueUrl:    appConfig.mq.url.priorDlQueUrl
  });

  // Download Image Demote
  params.push({
    targetDir:      dlImageNgDir,
    oppoDir:        dlImageOkDir,
    targetDirTag:   dlImageNgDirTag,
    oppoDirTag:     dlImageOkDirTag,
    fromTable:      dlTab,
    toTable:        igTab,
    otherTable1:    artTab,
    otherTable2:    stuTab,
    fromItemTags:   dlItemTags,
    toItemTags:     igItemTags,
    otherItemTags1: artItemTags,
    otherItemTags2: stuItemTags,
    priorQueUrl:    appConfig.mq.url.priorIgQueUrl
  });

  // Download Video Demote
  params.push({
    targetDir:      dlVideoNgDir,
    oppoDir:        dlVideoOkDir,
    targetDirTag:   dlVideoNgDirTag,
    oppoDirTag:     dlVideoOkDirTag,
    fromTable:      dlTab,
    toTable:        igTab,
    otherTable1:    artTab,
    otherTable2:    stuTab,
    fromItemTags:   dlItemTags,
    toItemTags:     igItemTags,
    otherItemTags1: artItemTags,
    otherItemTags2: stuItemTags,
    priorQueUrl:    appConfig.mq.url.priorIgQueUrl
  });

  // Artist Download
  params.push({
    targetDir:      artOkDir,
    oppoDir:        artNgDir,
    targetDirTag:   artOkDirTag,
    oppoDirTag:     artNgDirTag,
    fromTable:      artTab,
    toTable:        dlTab,
    otherTable1:    igTab,
    otherTable2:    stuTab,
    fromItemTags:   artItemTags,
    toItemTags:     dlItemTags,
    otherItemTags1: igItemTags,
    otherItemTags2: stuItemTags,
    priorQueUrl:    appConfig.mq.url.priorDlQueUrl
  });

  // Artist Ignore
  params.push({
    targetDir:      artNgDir,
    oppoDir:        artOkDir,
    targetDirTag:   artNgDirTag,
    oppoDirTag:     artOkDirTag,
    fromTable:      artTab,
    toTable:        igTab,
    otherTable1:    dlTab,
    otherTable2:    stuTab,
    fromItemTags:   artItemTags,
    toItemTags:     igItemTags,
    otherItemTags1: dlItemTags,
    otherItemTags2: stuItemTags,
    priorQueUrl:    appConfig.mq.url.priorIgQueUrl
  });

  // Studio Download
  params.push({
    targetDir:      stuOkDir,
    oppoDir:        stuNgDir,
    targetDirTag:   stuOkDirTag,
    oppoDirTag:     stuNgDirTag,
    fromTable:      stuTab,
    toTable:        dlTab,
    otherTable1:    igTab,
    otherTable2:    artTab,
    fromItemTags:   stuItemTags,
    toItemTags:     dlItemTags,
    otherItemTags1: igItemTags,
    otherItemTags2: artItemTags,
    priorQueUrl:    appConfig.mq.url.priorDlQueUrl
  });

  // Studio Ignore
  params.push({
    targetDir:      stuNgDir,
    oppoDir:        stuOkDir,
    targetDirTag:   stuNgDirTag,
    oppoDirTag:     stuOkDirTag,
    fromTable:      stuTab,
    toTable:        igTab,
    otherTable1:    dlTab,
    otherTable2:    artTab,
    fromItemTags:   stuItemTags,
    toItemTags:     igItemTags,
    otherItemTags1: dlItemTags,
    otherItemTags2: artItemTags,
    priorQueUrl:    appConfig.mq.url.priorIgQueUrl
  });

  const startMsg = appConfig.assign.msg.startMsg;
  console.info(startMsg);

  // 各パターンに対する処理のループ
  for (let param of params) {
    const fromTable = param.fromTable;
    const fromItemTags = param.fromItemTags;

    const toTable = param.toTable;
    const toItemTags = param.toItemTags;

    const otherTable1 = param.otherTable1;
    const otherItemTags1 = param.otherItemTags1;

    const otherTable2 = param.otherTable2;
    const otherItemTags2 = param.otherItemTags2;

    // 各タグフォルダに対する処理のループ
    const targetDir = param.targetDir;
    const oppoDir = param.oppoDir;
    const targetTags = param.targetDirTag;
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
    const oppoTags = param.oppoDirTag;
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
