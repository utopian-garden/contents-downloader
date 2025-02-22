// 依存パッケージ
import consoleStamp from 'console-stamp-color';
import fs from 'fs-extra';
import log4js from 'log4js';
import path from 'path';

consoleStamp(console, {
  format: ':date(yyyy/mm/dd HH:MM:ss.l) :label'
});

// ライブラリ
import correct from './correct.js';
import ddb from './ddb.js';
import sqs from './sqs.js';

// 設定ファイル
import appConfig from '../config/app-config.json' with { type: 'json' };

// 定義
const dir = appConfig.fs.dir;
const msg = appConfig.assign.msg;
const queUrl = appConfig.mq.url;
const search = appConfig.req.search;
const tab = appConfig.db.tab;

// 初期化
const logger = log4js.getLogger('system');

const tagAssign = async () => {
  // 各テーブルをスキャン
  const dlItems = await ddb.scanAll(tab.dlTable);
  const dlItemTags = dlItems.map(item => { return item.tag; });

  const igItems = await ddb.scanAll(tab.igTable);
  const igItemTags = igItems.map(item => { return item.tag; });

  // 各フォルダをスキャン
  const igOkDirTag = fs.readdirSync(dir.igOkDir);
  const igNgDirTag = fs.readdirSync(dir.igNgDir);
  const dlImageNgDirTag = fs.readdirSync(dir.dlImageNgDir);
  const dlImageOkDirTag = fs.readdirSync(dir.dlImageOkDir);
  const dlVideoNgDirTag = fs.readdirSync(dir.dlVideoNgDir);
  const dlVideoOkDirTag = fs.readdirSync(dir.dlVideoOkDir);

  // 各フォルダ処理のパラメータ設定
  const params = [];

  // Ignore Promote
  params.push({
    targetDir: dir.igOkDir,
    oppoDir: dir.igNgDir,
    targetDirTag: igOkDirTag,
    oppoDirTag: igNgDirTag,
    fromTable: tab.igTable,
    toTable: tab.dlTable,
    fromItemTags: igItemTags,
    toItemTags: dlItemTags,
    priorQueUrl: queUrl.priorDlQueUrl
  });

  // Download Image Demote
  params.push({
    targetDir: dir.dlImageNgDir,
    oppoDir: dir.dlImageOkDir,
    targetDirTag: dlImageNgDirTag,
    oppoDirTag: dlImageOkDirTag,
    fromTable: tab.dlTable,
    toTable: tab.igTable,
    fromItemTags: dlItemTags,
    toItemTags: igItemTags,
    priorQueUrl: queUrl.priorIgQueUrl
  });

  // Download Video Demote
  params.push({
    targetDir: dir.dlVideoNgDir,
    oppoDir: dir.dlVideoOkDir,
    targetDirTag: dlVideoNgDirTag,
    oppoDirTag: dlVideoOkDirTag,
    fromTable: tab.dlTable,
    toTable: tab.igTable,
    fromItemTags: dlItemTags,
    toItemTags: igItemTags,
    priorQueUrl: queUrl.priorIgQueUrl
  });

  console.info(msg.startMsg);

  // 各パターンに対する処理のループ
  for (let param of params) {
    const fromTable = param.fromTable;
    const fromItemTags = param.fromItemTags;

    const toTable = param.toTable;
    const toItemTags = param.toItemTags;

    // 各タグフォルダに対する処理のループ
    const targetDir = param.targetDir;
    const oppoDir = param.oppoDir;
    const targetTags = param.targetDirTag;
    for (let targetTag of targetTags) {
      const targetTagDir = path.join(targetDir, targetTag);
      const oppoTagDir = path.join(oppoDir, targetTag);

      // タグがテーブルに存在するか確認 (末尾 '.' の補正つき)
      let fixedTargetTag;
      if (fromItemTags.includes(targetTag) || toItemTags.includes(targetTag)) {
        fixedTargetTag = targetTag;
      } else if (fromItemTags.includes(targetTag + '.') || toItemTags.includes(targetTag + '.')) {
        fixedTargetTag = targetTag + '.';
      }

      // 存在する場合
      if (fixedTargetTag) {
        // DB レコードの移動
        const toTable = param.toTable;
        await ddb.addItem(toTable, fixedTargetTag);
        await ddb.deleteItem(fromTable, fixedTargetTag);

        // サブフォルダの削除
        fs.removeSync(targetTagDir);
        fs.removeSync(oppoTagDir);

        // MQ のリクエストキューにメッセージを送信
        const priorQueUrl = param.priorQueUrl;
        const msgBody = JSON.stringify({ 'tag': targetTag, 'last': '0' });
        await sqs.sendMsg(priorQueUrl, msgBody);
      } else {
        logger.debug(toTable, search.chanSearchUrl + targetTag + search.chanSearchParam,
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
      } else if (toItemTags.includes(oppoTag)) {
        wrongOppoTag = oppoTag;
      } else if (toItemTags.includes(oppoTag + '.')) {
        wrongOppoTag = oppoTag + '.';
      }

      if (wrongOppoTag) {
        // 対向のテーブルに存在する場合は補正する
        await ddb.addItem(fromTable, wrongOppoTag);
        await ddb.deleteItem(toTable, wrongOppoTag);
      } else if (!fixedOppoTag) {
        // テーブルに存在しない場合はタグをログに出力
        // (例えば image/_ok/ にフォルダが存在するのに Download テーブルにはタグがない等)
        logger.debug(fromTable, search.chanSearchUrl + oppoTag + search.chanSearchParam,
          path.join(oppoDir, oppoTag));
      }
    }
  }

  // DB の重複修正
  correct.dupCorrect();

  console.info(msg.finMsg);
};

const assign = { tagAssign };
export default assign;
