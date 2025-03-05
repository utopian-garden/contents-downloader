// 依存パッケージ
import consoleStamp from 'console-stamp-color';
import fs from 'fs-extra';
import log4js from 'log4js';
import path from 'path';

consoleStamp(console, {
  format: ':date(yyyy/mm/dd HH:MM:ss.l) :label'
});

// ライブラリ
import { dupCorrect } from './correct.js';
import { scanAll, addItem, deleteItem } from './ddb.js';
import { sendMsg } from './sqs.js';

// 設定ファイル
import appConfig from '../config/app-config.json' with { type: 'json' };

// 定義
const {
  dlImageOkDir, dlImageNgDir, dlVideoOkDir, dlVideoNgDir, igOkDir, igNgDir
} = appConfig.fs.dir;
const { startMsg, finMsg } = appConfig.assign.msg;
const { priorDlQueUrl, priorIgQueUrl } = appConfig.mq.url;
const { dlTable, igTable } = appConfig.db.tab;

// 初期化
const logger = log4js.getLogger('system');

const tagAssign = async () => {
  // 各テーブルをスキャン
  const dlItems = await scanAll(dlTable);
  const dlItemTags = dlItems.map(item => { return item.tag; });

  const igItems = await scanAll(igTable);
  const igItemTags = igItems.map(item => { return item.tag; });

  // 各フォルダをスキャン
  const igOkDirTag = fs.readdirSync(igOkDir);
  const igNgDirTag = fs.readdirSync(igNgDir);
  const dlImageNgDirTag = fs.readdirSync(dlImageNgDir);
  const dlImageOkDirTag = fs.readdirSync(dlImageOkDir);
  const dlVideoNgDirTag = fs.readdirSync(dlVideoNgDir);
  const dlVideoOkDirTag = fs.readdirSync(dlVideoOkDir);

  // 各フォルダ処理のパラメータ設定
  const params = [];

  // Ignore Promote
  params.push({
    targetDir: igOkDir,
    oppoDir: igNgDir,
    targetDirTag: igOkDirTag,
    oppoDirTag: igNgDirTag,
    fromTable: igTable,
    toTable: dlTable,
    fromItemTags: igItemTags,
    toItemTags: dlItemTags,
    priorQueUrl: priorDlQueUrl
  });

  // Download Image Demote
  params.push({
    targetDir: dlImageNgDir,
    oppoDir: dlImageOkDir,
    targetDirTag: dlImageNgDirTag,
    oppoDirTag: dlImageOkDirTag,
    fromTable: dlTable,
    toTable: igTable,
    fromItemTags: dlItemTags,
    toItemTags: igItemTags,
    priorQueUrl: priorIgQueUrl
  });

  // Download Video Demote
  params.push({
    targetDir: dlVideoNgDir,
    oppoDir: dlVideoOkDir,
    targetDirTag: dlVideoNgDirTag,
    oppoDirTag: dlVideoOkDirTag,
    fromTable: dlTable,
    toTable: igTable,
    fromItemTags: dlItemTags,
    toItemTags: igItemTags,
    priorQueUrl: priorIgQueUrl
  });

  console.info(startMsg);

  // 各パターンに対する処理のループ
  for (let param of params) {
    const {
      targetDir, oppoDir, targetDirTag: targetTags, oppoDirTag: oppoTags, fromTable, toTable,
      fromItemTags, toItemTags, priorQueUrl
    } = param;

    // 各タグフォルダに対する処理のループ
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
        const toTable = toTable;
        await addItem(toTable, fixedTargetTag);
        await deleteItem(fromTable, fixedTargetTag);

        // サブフォルダの削除
        fs.removeSync(targetTagDir);
        fs.removeSync(oppoTagDir);

        // MQ のリクエストキューにメッセージを送信
        const msgBody = JSON.stringify({ 'tag': targetTag, 'last': '0' });
        await sendMsg(priorQueUrl, msgBody);
      } else {
        logger.debug(
          toTable, targetTag, path.join(targetDir, targetTag)
        );
      }
    }

    // 対向の (上記で処理しない側、ファイルを残す側) の各タグフォルダに対するループ
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
        await addItem(fromTable, wrongOppoTag);
        await deleteItem(toTable, wrongOppoTag);
      } else if (!fixedOppoTag) {
        // テーブルに存在しない場合はタグをログに出力
        // (例えば image/_ok/ にフォルダが存在するのに Download テーブルにはタグがない等)
        logger.debug(
          fromTable, oppoTag, path.join(oppoDir, oppoTag)
        );
      }
    }
  }

  // DB の重複修正
  dupCorrect();

  console.info(finMsg);
};

export { tagAssign };
