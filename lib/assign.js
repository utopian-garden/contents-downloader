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

// 定義
const tab = appConfig.db.tab;
const dir = appConfig.fs.dir;
const queUrl = appConfig.mq.url;
const msg = appConfig.assign.msg;

const chanSearchUrl = appConfig.req.search.chanSearchUrl;
const chanSearchParam = appConfig.req.search.chanSearchParam;

// 初期化
const logger = log4js.getLogger('system');

exports.tagAssign = async () => {
  // 各テーブルをスキャン
  const dlItems = await ddb.scanAll(tab.dlTable);
  const dlItemTags = dlItems.map(item => { return item.tag });

  const igItems = await ddb.scanAll(tab.igTable);
  const igItemTags = igItems.map(item => { return item.tag });

  const artItems = await ddb.scanAll(tab.artTable);
  const artItemTags = artItems.map(item => { return item.tag });

  const stuItems = await ddb.scanAll(tab.stuTable);
  const stuItemTags = stuItems.map(item => { return item.tag });

  // 各フォルダをスキャン
  const igOkDirTag = fs.readdirSync(dir.igOkDir);
  const igNgDirTag = fs.readdirSync(dir.igNgDir);
  const dlImageNgDirTag = fs.readdirSync(dir.dlImageNgDir);
  const dlImageOkDirTag = fs.readdirSync(dir.dlImageOkDir);
  const dlVideoNgDirTag = fs.readdirSync(dir.dlVideoNgDir);
  const dlVideoOkDirTag = fs.readdirSync(dir.dlVideoOkDir);
  const artOkDirTag = fs.readdirSync(dir.artOkDir);
  const artNgDirTag = fs.readdirSync(dir.artNgDir);
  const stuOkDirTag = fs.readdirSync(dir.stuOkDir);
  const stuNgDirTag = fs.readdirSync(dir.stuNgDir);

  // 各フォルダ処理のパラメータ設定
  const params = [];

  // Ignore Promote
  params.push({
    targetDir:      dir.igOkDir,
    oppoDir:        dir.igNgDir,
    targetDirTag:   igOkDirTag,
    oppoDirTag:     igNgDirTag,
    fromTable:      tab.igTable,
    toTable:        tab.dlTable,
    otherTable1:    tab.artTable,
    otherTable2:    tab.stuTable,
    fromItemTags:   igItemTags,
    toItemTags:     dlItemTags,
    otherItemTags1: artItemTags,
    otherItemTags2: stuItemTags,
    priorQueUrl:    queUrl.priorDlQueUrl
  });

  // Download Image Demote
  params.push({
    targetDir:      dir.dlImageNgDir,
    oppoDir:        dir.dlImageOkDir,
    targetDirTag:   dlImageNgDirTag,
    oppoDirTag:     dlImageOkDirTag,
    fromTable:      tab.dlTable,
    toTable:        tab.igTable,
    otherTable1:    tab.artTable,
    otherTable2:    tab.stuTable,
    fromItemTags:   dlItemTags,
    toItemTags:     igItemTags,
    otherItemTags1: artItemTags,
    otherItemTags2: stuItemTags,
    priorQueUrl:    queUrl.priorIgQueUrl
  });

  // Download Video Demote
  params.push({
    targetDir:      dir.dlVideoNgDir,
    oppoDir:        dir.dlVideoOkDir,
    targetDirTag:   dlVideoNgDirTag,
    oppoDirTag:     dlVideoOkDirTag,
    fromTable:      tab.dlTable,
    toTable:        tab.igTable,
    otherTable1:    tab.artTable,
    otherTable2:    tab.stuTable,
    fromItemTags:   dlItemTags,
    toItemTags:     igItemTags,
    otherItemTags1: artItemTags,
    otherItemTags2: stuItemTags,
    priorQueUrl:    queUrl.priorIgQueUrl
  });

  // Artist Download
  params.push({
    targetDir:      dir.artOkDir,
    oppoDir:        dir.artNgDir,
    targetDirTag:   artOkDirTag,
    oppoDirTag:     artNgDirTag,
    fromTable:      tab.artTable,
    toTable:        tab.dlTable,
    otherTable1:    tab.igTable,
    otherTable2:    tab.stuTable,
    fromItemTags:   artItemTags,
    toItemTags:     dlItemTags,
    otherItemTags1: igItemTags,
    otherItemTags2: stuItemTags,
    priorQueUrl:    queUrl.priorDlQueUrl
  });

  // Artist Ignore
  params.push({
    targetDir:      dir.artNgDir,
    oppoDir:        dir.artOkDir,
    targetDirTag:   artNgDirTag,
    oppoDirTag:     artOkDirTag,
    fromTable:      tab.artTable,
    toTable:        tab.igTable,
    otherTable1:    tab.dlTable,
    otherTable2:    tab.stuTable,
    fromItemTags:   artItemTags,
    toItemTags:     igItemTags,
    otherItemTags1: dlItemTags,
    otherItemTags2: stuItemTags,
    priorQueUrl:    queUrl.priorIgQueUrl
  });

  // Studio Download
  params.push({
    targetDir:      dir.stuOkDir,
    oppoDir:        dir.stuNgDir,
    targetDirTag:   stuOkDirTag,
    oppoDirTag:     stuNgDirTag,
    fromTable:      tab.stuTable,
    toTable:        tab.dlTable,
    otherTable1:    tab.igTable,
    otherTable2:    tab.artTable,
    fromItemTags:   stuItemTags,
    toItemTags:     dlItemTags,
    otherItemTags1: igItemTags,
    otherItemTags2: artItemTags,
    priorQueUrl:    queUrl.priorDlQueUrl
  });

  // Studio Ignore
  params.push({
    targetDir:      dir.stuNgDir,
    oppoDir:        dir.stuOkDir,
    targetDirTag:   stuNgDirTag,
    oppoDirTag:     stuOkDirTag,
    fromTable:      tab.stuTable,
    toTable:        tab.igTable,
    otherTable1:    tab.dlTable,
    otherTable2:    tab.artTable,
    fromItemTags:   stuItemTags,
    toItemTags:     igItemTags,
    otherItemTags1: dlItemTags,
    otherItemTags2: artItemTags,
    priorQueUrl:    queUrl.priorIgQueUrl
  });

  console.info(msg.startMsg);

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

  console.info(msg.finMsg);
}
