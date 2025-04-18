// 依存パッケージ
import consoleStamp from 'console-stamp-color';
import express from 'express';
import fs from 'fs-extra';
import log4js from 'log4js';
import path from 'path';
import sanitize from 'sanitize-filename';
import cors from 'cors';

consoleStamp(console, {
  format: ':date(yyyy/mm/dd HH:MM:ss.l) :label'
});

// ライブラリ
import { tagAssign } from './assign.js';
import { getItem, addItem, deleteItem } from './ddb.js';
import { fileOrganize } from './organize.js';
import { mqRefill } from './refill.js';
import { sendMsg } from './sqs.js';

// 設定ファイル
import appConfig from '../config/app-config.json' with { type: 'json' };

// 初期化
log4js.configure('./config/api-log-config.json');
const logger = log4js.getLogger('system');
const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cors());

// 定義
const { chkDbUri, addItemUri, refillUri, assignUri, organizeUri, getLinkUri } = appConfig.api.uri;
const { startMsg } = appConfig.api.msg;
const { priorIgQueUrl, priorDlQueUrl } = appConfig.mq.url;
const { dlTable, igTable } = appConfig.db.tab;

// check db
app.get(chkDbUri, async (req, res) => {
  try {
    const { tag: reqTag } = req.query;

    // Download と Ignore から tag が一致する item を取得
    const dlItems = await getItem(dlTable, reqTag);
    const igItems = await getItem(igTable, reqTag);
    let resTable;

    // item が入っている DB を判定
    if (dlItems.Item) {
      resTable = dlTable;
    } else if (igItems.Item) {
      resTable = igTable;
    } else {
      resTable = 'None';
    }

    // 判定結果を返す
    res.json({ success: true, table: resTable, tag: reqTag });
  } catch (err) {
    // エラーを返す
    logger.error('chkDbUri', err.message);

    res.status(500).json({ success: false });
  }
});

// add item
app.post(addItemUri, async (req, res) => {
  try {
    const { table: reqTable, tag: reqTag } = req.body;
    const {
      dlImageDir, dlImageOkDir, dlImageNgDir, dlVideoDir, dlVideoOkDir, dlVideoNgDir, igDir, igNgDir
    } = appConfig.fs.dir;

    const saniReqTag = sanitize(reqTag);
    let msgBody;

    console.debug(reqTag);

    // 入力チェック
    switch (reqTable) {
      // Ignore の場合
      case igTable:
        // Ignore テーブルへの追加と Download テーブルからの削除
        await addItem(reqTable, reqTag);
        await deleteItem(dlTable, reqTag);

        // MQ のリクエストキューにメッセージを送信
        msgBody = JSON.stringify({ tag: reqTag, last: '0' });
        await sendMsg(priorIgQueUrl, msgBody);

        // Ignore に登録する場合は既存の DL フォルダを削除
        if (saniReqTag) {
          const dlImageTagDir = path.join(dlImageDir, saniReqTag);
          const dlImageOkTagDir = path.join(dlImageOkDir, saniReqTag);
          const dlImageNgTagDir = path.join(dlImageNgDir, saniReqTag);
          const dlVideoTagDir = path.join(dlVideoDir, saniReqTag);
          const dlVideoOkTagDir = path.join(dlVideoOkDir, saniReqTag);
          const dlVideoNgTagDir = path.join(dlVideoNgDir, saniReqTag);

          fs.removeSync(dlImageTagDir);
          fs.removeSync(dlImageOkTagDir);
          fs.removeSync(dlImageNgTagDir);
          fs.removeSync(dlVideoTagDir);
          fs.removeSync(dlVideoOkTagDir);
          fs.removeSync(dlVideoNgTagDir);
        }

        break;

      // Download の場合
      case dlTable:
        // Download テーブルへの追加と Ignore テーブルからの削除
        await addItem(reqTable, reqTag);
        await deleteItem(igTable, reqTag);

        // MQ のリクエストキューにメッセージを送信
        msgBody = JSON.stringify({ tag: reqTag, last: '0' });
        await sendMsg(priorDlQueUrl, msgBody);

        // Download に登録する場合は既存の Ignore フォルダを削除
        if (saniReqTag) {
          const igTagDir = path.join(igDir, saniReqTag);
          const igNgTagDir = path.join(igNgDir, saniReqTag);

          fs.removeSync(igTagDir);
          fs.removeSync(igNgTagDir);
        }

        break;
    }

    res.json({ success: true, table: reqTable, tag: reqTag });
  } catch (err) {
    logger.error('addItemUri', err.message);

    res.status(500).json({ success: false });
  }
});

// refill
app.post(refillUri, async (req, res) => {
  const { table: reqTable } = req.body;

  try {
    // 対象のリクエストキューに refill を実行
    await mqRefill(reqTable);
  } catch (err) {
    logger.error('refillUri', err.message);
  }

  res.json({ accept: true, table: reqTable });
});

// assign
app.post(assignUri, async (req, res) => {
  try {
    // assign を実行
    await tagAssign();
  } catch (err) {
    logger.error('assignUri', err.message);
  }

  res.json({ accept: true });
});

// organize
app.post(organizeUri, async (req, res) => {
  try {
    // organize を実行
    await fileOrganize();
  } catch (err) {
    logger.error('organizeUri', err.message);
  }

  res.json({ accept: true });
});

// get link
app.post(getLinkUri, async (req, res) => {
  try {
    // 受け取った url をログに出力
    const { url } = req.body;
    fs.appendFileSync('log/torrent.txt', `${url}\n`);
  } catch (err) {
    logger.error('getLinkUri', err.message);
  }

  res.json({ accept: true });
});

// サーバ起動
app.listen(3000);

console.info(startMsg);
