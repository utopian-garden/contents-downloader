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
const dlPosts = async () => {
  // 初期化
  log4js.configure('./config/download-log-config.json');
  const logger = log4js.getLogger('system');

  // ループ処理の開始
  let waitCount = 0;
  let loop = true;

  get_loop:
  while (loop) {
    // 通常キューからメッセージを取得
    const searchQueUrl = queUrl.searchQueUrl;
    let searchQueRes;
    try {
      searchQueRes = await sqs.recvMsg(searchQueUrl);
    } catch (err) {
      logger.error('recvMsg', searchQueUrl, err);
      continue get_loop;
    }

    // メッセージを取得できない場合は後続をスキップしてメッセージ待ち
    if (!searchQueRes) {
      waitCount++;

      if (waitCount === 5) {
        console.info(msg.waitingMsg);
      }
      await waitTimer(quePoll.dlQuePoll);

      continue get_loop;
    }

    waitCount = 0;
    const tagKey = decodeURIComponent(searchQueRes.tagKey);
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
    const dlItems = searchQueRes.msgData;
    if (!dlItems) {
      continue get_loop;
    }

    const pageNum = Number(searchQueRes.pageNum);
    console.info(tagKey, pageNum);

    // 検索結果でループ
    item_loop:
    for (let post of dlItems) {
      const postId = post.id;

      // ファイル名の整形
      const fileUrl = post.file_url;
      const fileExt = (fileUrl.match(/.*\.(.*)\?.*/))[1];
      const fileName = postId + '.' + fileExt;

      // ダウンロード先の仕分け
      let dlDir;
      if (ext.imageExts.includes(fileExt)) {
        dlDir = dlImageTagDir;
      } else {
        dlDir = dlVideoTagDir;
      }

      const filePath = path.join(dlDir, fileName);

      // ファイルの存在チェック
      if (dlImageFiles.includes(fileName) ||
        dlImageOkFiles.includes(fileName) ||
        dlVideoFiles.includes(fileName) ||
        dlVideoOkFiles.includes(fileName)) {

        continue item_loop;
      }

      // ディレクトリの作成
      fs.ensureDirSync(dlDir);

      // テンプレートファイルの配布
      const toolDir = dir.toolDir;
      const orderBat = file.orderBat;
      const orderPs1 = file.orderPs1;
      const orderLst = file.orderLst;
      const batFrom = path.join(toolDir, orderBat);
      const batTo = path.join(dlDir, orderBat);
      const ps1From = path.join(toolDir, orderPs1);
      const ps1To = path.join(dlDir, orderPs1);
      const lstFrom = path.join(toolDir, orderLst);
      const lstTo = path.join(dlDir, orderLst);

      if (!fs.pathExistsSync(batTo)) {
        fs.copySync(batFrom, batTo);
      }

      if (!fs.pathExistsSync(ps1To)) {
        fs.copySync(ps1From, ps1To);
      }
      if (!fs.pathExistsSync(lstTo)) {
        fs.copySync(lstFrom, lstTo);
      }

      let loop = true;

      // ダウンロード リクエスト
      dl_loop:
      while (loop) {
        const refererUrl = dl.refererUrl + postId;
        try {
          await req.dlContent(filePath, fileUrl, refererUrl);
          break dl_loop;
        } catch (err) {
          // 失敗した場合
          if (!err.response) {
            switch (err.code) {
              // レスポンスがないならリトライ、ただしエラーコードによっては中止
              default:
                logger.error('dlContent', filePath, fileUrl, refererUrl, err.code);
                await waitTimer(reqPoll.middlePoll);
                continue dl_loop;
            }
          } else {
            switch (err.response.status) {
              // レスポンスがあるならリトライ、ただしステータスによっては中止
              case 403:
              case 404:
                logger.error('dlContent', filePath, fileUrl, refererUrl, err.response.status);
                await waitTimer(reqPoll.shortPoll);
                break dl_loop;

              default:
                logger.error('dlContent', filePath, fileUrl, refererUrl, err.response.status);
                await waitTimer(reqPoll.middlePoll);
                continue dl_loop;
            }
          }
        }
      }

      await waitTimer(reqPoll.shortPoll);
    }
  }
};

// Wait 処理
const waitTimer = (quePoll) => {
  return new Promise((resolve) => {
    setTimeout(resolve, quePoll * 1000);
  });
};

dlPosts();
