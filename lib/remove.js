// 依存パッケージ
import consoleStamp from 'console-stamp-color';
import fs from 'fs-extra';
import log4js from 'log4js';
import path from 'path';
import sanitize from 'sanitize-filename';

consoleStamp(console, {
  format: ':date(yyyy/mm/dd HH:MM:ss.l) :label'
});

// ライブラリ
import { recvMsg } from './sqs.js';
import { walkFileSync } from './walk.js';

// 設定ファイル
import appConfig from '../config/app-config.json' with { type: 'json' };

// 定義
const { dlImageDir, dlImageOkDir, dlVideoDir, dlVideoOkDir } = appConfig.fs.dir;
const { waitingMsg } = appConfig.mq.msg;
const { rmQuePoll } = appConfig.mq.poll;
const { removeQueUrl } = appConfig.mq.url;

// ポストのダウンロード処理
const rmPosts = async () => {
  // 初期化
  log4js.configure('./config/remove-log-config.json');
  const logger = log4js.getLogger('system');

  // ループ処理の開始
  let waitCount = 0;
  let loop = true;

  get_loop:
  while (loop) {
    // 通常キューからメッセージを取得
    let removeQueRes;
    try {
      removeQueRes = await recvMsg(removeQueUrl);
    } catch (err) {
      logger.error('recvMsg', removeQueUrl, err);
      continue get_loop;
    }

    // メッセージを取得できない場合は後続をスキップしてメッセージ待ち
    if (!removeQueRes) {
      waitCount++;

      if (waitCount === 5) {
        console.info(waitingMsg);
      }
      await waitTimer(rmQuePoll);

      continue get_loop;
    }

    waitCount = 0;

    const { tagKey, pageNum: strPageNum, msgData } = removeQueRes;

    const decTagKey = decodeURIComponent(tagKey);
    const saniTagKey = sanitize(decTagKey);

    // 既存ファイル名の取得
    const dlImageTagDir = path.join(dlImageDir, saniTagKey);
    const dlImageOkTagDir = path.join(dlImageOkDir, saniTagKey);
    const dlImageFiles = await walkFileSync(dlImageTagDir);
    const dlImageOkFiles = await walkFileSync(dlImageOkTagDir);

    const dlVideoTagDir = path.join(dlVideoDir, saniTagKey);
    const dlVideoOkTagDir = path.join(dlVideoOkDir, saniTagKey);
    const dlVideoFiles = await walkFileSync(dlVideoTagDir);
    const dlVideoOkFiles = await walkFileSync(dlVideoOkTagDir);

    // 続行条件のチェック
    const rmItems = msgData;
    if (!rmItems) {
      continue get_loop;
    }

    const pageNum = Number(strPageNum);
    console.info(decTagKey, pageNum);

    // NG 結果でループ
    for (let post of rmItems) {
      const { id: postId, file_url: fileUrl } = post;

      // ファイル名の整形
      const fileExt = (fileUrl.match(/.*\.(.*)\?.*/))[1];
      const fileName = postId + '.' + fileExt;

      // ファイルの存在チェックと削除
      if (dlImageFiles.includes(fileName)) {
        fs.removeSync(path.join(dlImageTagDir, fileName));
        fs.removeSync(path.join(dlImageTagDir, 'image', fileName));
        fs.removeSync(path.join(dlImageTagDir, 'image', 'ok', fileName));
      }

      // ファイルの存在チェックと削除
      if (dlImageOkFiles.includes(fileName)) {
        fs.removeSync(path.join(dlImageOkTagDir, fileName));
        fs.removeSync(path.join(dlImageOkTagDir, 'image', fileName));
        fs.removeSync(path.join(dlImageOkTagDir, 'image', 'ok', fileName));
      }

      // ファイルの存在チェックと削除
      if (dlVideoFiles.includes(fileName)) {
        fs.removeSync(path.join(dlVideoTagDir, fileName));
        fs.removeSync(path.join(dlVideoTagDir, 'video', fileName));
        fs.removeSync(path.join(dlVideoTagDir, 'video', 'ok', fileName));
      }

      // ファイルの存在チェックと削除
      if (dlVideoOkFiles.includes(fileName)) {
        fs.removeSync(path.join(dlVideoOkTagDir, fileName));
        fs.removeSync(path.join(dlVideoOkTagDir, 'video', fileName));
        fs.removeSync(path.join(dlVideoOkTagDir, 'video', 'ok', fileName));
      }
    }
  }
};

// Wait 処理
const waitTimer = (quePoll) => {
  return new Promise((resolve) => {
    setTimeout(resolve, quePoll * 1000);
  });
};

rmPosts();
