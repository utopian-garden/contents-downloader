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
import { dlContent } from './req.js';
import { recvMsg } from './sqs.js';
import { walkFileSync } from './walk.js';

// 設定ファイル
import appConfig from '../config/app-config.json' with { type: 'json' };

// 定義
const { dlImageDir, dlImageOkDir, dlVideoDir, dlVideoOkDir, toolDir } = appConfig.fs.dir;
const { refererUrl } = appConfig.req.dl;
const { imageExts } = appConfig.fs.ext;
const { orderBat, orderPs1, orderLst } = appConfig.fs.file;
const { waitingMsg } = appConfig.mq.msg;
const { dlQuePoll } = appConfig.mq.poll;
const { searchQueUrl } = appConfig.mq.url;
const { shortPoll } = appConfig.req.poll;

// ポストのダウンロード処理
const dlPosts = async (dlType) => {
  // 初期化
  log4js.configure('./config/download-log-config.json');
  const logger = log4js.getLogger('system');

  // ループ処理の開始
  let waitCount = 0;
  let loop = true;

  get_loop:
  while (loop) {
    // 通常キューからメッセージを取得
    let searchQueRes;
    try {
      searchQueRes = await recvMsg(searchQueUrl);
    } catch (err) {
      logger.error('recvMsg', searchQueUrl, err);
      continue get_loop;
    }

    // メッセージを取得できない場合は後続をスキップしてメッセージ待ち
    if (!searchQueRes) {
      waitCount++;

      if (waitCount === 5) {
        console.info(waitingMsg);
      }
      await waitTimer(dlQuePoll);

      continue get_loop;
    }

    waitCount = 0;
    const { tagKey, pageNum: strPageNum, msgData: dlItems } = searchQueRes;
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
    if (!dlItems) {
      continue get_loop;
    }

    const pageNum = Number(strPageNum);
    console.info(decTagKey, pageNum);

    const postArray = [];

    // 検索結果でループ
    item_loop:
    for (let post of dlItems) {
      const { id: postId, file_url: fileUrl } = post;

      // ファイル名の整形
      const fileExt = (fileUrl.match(/.*\.(.*)\?.*/))[1];
      const fileName = postId + '.' + fileExt;

      // ダウンロード先の仕分け
      let dlDir;
      if (imageExts.includes(fileExt)) {
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

      let remainRetry = 3;

      // ダウンロード リクエスト
      dl_loop:
      while (remainRetry > 0) {
        try {
          await dlContent(filePath, fileUrl, refererUrl);
          break dl_loop;
        } catch (err) {
          // 失敗した場合
          if (err.code === 'ERR_NON_2XX_3XX_RESPONSE') {
            switch (err.response.statusCode) {
              // レスポンスがあるならリトライ、ただしステータスによっては中止
              case 403:
              case 404:
              case 503:
                remainRetry -= 1;
                logger.error('dlContent', filePath, err.response.statusCode);
                await waitTimer(shortPoll);
                continue dl_loop;

              default:
                remainRetry = 3;
                logger.error('dlContent', filePath, err.response.statusCode);
                await waitTimer(shortPoll);
                continue dl_loop;
            }
          } else {
            switch (err.code) {
              // エラーが発生した場合はリトライ、ただしエラーコードによっては中止
              default:
                remainRetry = 3;
                logger.error('dlContent', filePath, err.code);
                await waitTimer(shortPoll);
                continue dl_loop;
            }
          }
        }
      }

      // ファイルサイズが 0 の場合は削除
      const tmpFilePath = filePath + '.temp';
      if (fs.existsSync(tmpFilePath)) {
        const { size: fileSize } = fs.statSync(tmpFilePath);
        if (fileSize === 0) {
          fs.removeSync(tmpFilePath);
        }
      }

      // ダウンロードが完了したもののみ postid の配列に追加
      postArray.push(postId);

      await waitTimer(shortPoll);
    }

    // Tag テーブルに postid の配列を追加する (差分ダウンロードの場合のみ)
    if (dlType === 'Diff') {
      try {
        await addArrayItem(tagTable, tagKey, postAttr, postArray);
      } catch (err) {
        logger.error('addArrayItem', JSON.stringify(err));
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

const dlType = process.argv[2];

if (dlType) {
  dlPosts(dlType);
} else {
  console.info('Usage: node ' + path.basename(process.argv[1]) + ' <Download Type (Full/Diff)>');
}
