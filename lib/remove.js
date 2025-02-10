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
import req from './req.js';
import sqs from './sqs.js';
import walk from './walk.js';

// 設定ファイル
import appConfig from '../config/app-config.json' with { type: 'json' };

// 定義
const dir = appConfig.fs.dir;
const dl = appConfig.req.dl;
const ext = appConfig.fs.ext;
const file = appConfig.fs.file;
const msg = appConfig.mq.msg;
const quePoll = appConfig.mq.poll;
const queUrl = appConfig.mq.url;
const reqPoll = appConfig.req.poll;

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
    const removeQueUrl = queUrl.removeQueUrl;
    let removeQueRes;
    try {
      removeQueRes = await sqs.recvMsg(removeQueUrl);
    } catch (err) {
      logger.error('recvMsg', removeQueUrl, err);
      continue get_loop;
    }

    // メッセージを取得できない場合は後続をスキップしてメッセージ待ち
    if (!removeQueRes) {
      waitCount++;

      if (waitCount === 5) {
        console.info(msg.waitingMsg);
      }
      await waitTimer(quePoll.rmQuePoll);

      continue get_loop;
    }

    waitCount = 0;
    const tagKey = decodeURIComponent(removeQueRes.tagKey);
    const saniTagKey = sanitize(tagKey);

    // 既存ファイル名の取得
    const dlImageTagDir = path.join(dir.dlImageDir, saniTagKey);
    const dlImageOkTagDir = path.join(dir.dlImageOkDir, saniTagKey);
    const dlImageFiles = await walk.walkFileSync(dlImageTagDir);
    const dlImageOkFiles = await walk.walkFileSync(dlImageOkTagDir);

    const dlVideoTagDir = path.join(dir.dlVideoDir, saniTagKey);
    const dlVideoOkTagDir = path.join(dir.dlVideoOkDir, saniTagKey);
    const dlVideoFiles = await walk.walkFileSync(dlVideoTagDir);
    const dlVideoOkFiles = await walk.walkFileSync(dlVideoOkTagDir);

    // 続行条件のチェック
    const rmItems = removeQueRes.msgData;
    if (!rmItems) {
      continue get_loop;
    }

    const pageNum = Number(removeQueRes.pageNum);
    console.info(tagKey, pageNum);

    // NG 結果でループ
    for (let post of rmItems) {
      const postId = post.id;

      // ファイル名の整形
      const fileUrl = post.file_url;
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
        fs.removeSync(path.join(dlVideoTagDir, 'image', fileName));
        fs.removeSync(path.join(dlVideoTagDir, 'image', 'ok', fileName));
      }

      // ファイルの存在チェックと削除
      if (dlVideoOkFiles.includes(fileName)) {
        fs.removeSync(path.join(dlVideoOkTagDir, fileName));
        fs.removeSync(path.join(dlVideoOkTagDir, 'image', fileName));
        fs.removeSync(path.join(dlVideoOkTagDir, 'image', 'ok', fileName));
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
