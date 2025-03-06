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
import { getItem, updateItem, addArrayItem, deleteItem } from './ddb.js';
import { getToken, searchPost, dlContent } from './req.js';
import { recvMsg } from './sqs.js';
import { walkFileSync } from './walk.js';

// 設定ファイル
import appConfig from '../config/app-config.json' with { type: 'json' };

// 定義
const { postAttr } = appConfig.db.attr;
const { igDir, igOkDir, igNgDir } = appConfig.fs.dir;
const { refererUrl } = appConfig.req.dl;
const { ignoreExts } = appConfig.fs.ext;
const { waitingMsg } = appConfig.mq.msg;
const { ngTag, ngId, ngText } = appConfig.ng;
const { igQuePoll } = appConfig.mq.poll;
const { igQueUrl, priorIgQueUrl } = appConfig.mq.url;
const { shortPoll, middlePoll, longPoll } = appConfig.req.poll;
const { igTable, tagTable } = appConfig.db.tab;

// ポストのダウンロード処理
const extraDlPosts = async (dlType) => {
  let targetQuePoll;
  let targetQueUrl;
  let priorQueUrl;
  let tabName;
  let typeDir;
  let typeOkDir;
  let typeNgDir;

  switch (dlType) {
    case igTable:
      log4js.configure('./config/dl-ig-log-config.json');
      tabName = igTable;
      targetQueUrl = igQueUrl;
      priorQueUrl = priorIgQueUrl;
      targetQuePoll = igQuePoll;
      typeDir = igDir;
      typeOkDir = igOkDir;
      typeNgDir = igNgDir;
      break;
  }

  // 初期化
  const logger = log4js.getLogger('system');

  // 認証リクエスト
  let authToken;
  while (!authToken) {
    try {
      authToken = await getToken();
    } catch (err) {
      logger.error('getToken', err.message);
      await waitTimer(longPoll);
    }
  }

  // ループ処理開始
  let waitCount = 0;
  let loop = true;

  get_loop:
  while (loop) {
    // 優先キューからメッセージを取得
    let tagMsg;
    try {
      tagMsg = await recvMsg(priorQueUrl);
    } catch (err) {
      logger.error('recvMsg', priorQueUrl, err);
      await waitTimer(targetQuePoll);
    }

    // 通常キューからメッセージを取得
    if (!tagMsg) {
      try {
        tagMsg = await recvMsg(targetQueUrl);
      } catch (err) {
        logger.error('recvMsg', targetQueUrl, err);
        await waitTimer(targetQuePoll);
      }
    }

    // メッセージを取得できない場合は後続をスキップしてメッセージ待ち
    if (!tagMsg) {
      waitCount++;

      if (waitCount === 5) {
        console.info(waitingMsg);
      }

      await waitTimer(targetQuePoll);

      continue get_loop;
    }

    waitCount = 0;

    // 対象タグが DB に存在するかチェックし、存在しない場合はスキップ
    const { tag: tagKey } = tagMsg;
    if (ngTag.includes(tagKey)) {
      continue get_loop;
    }

    let tabItems;
    try {
      tabItems = await getItem(tabName, tagKey);
    } catch (err) {
      logger.error('getItem', JSON.stringify(err));
      continue get_loop;
    }

    if (!tabItems.Item) {
      continue get_loop;
    }

    // Tag テーブルのタグの postid を削除
    await deleteItem(tagTable, tagKey);
    await updateItem(tagTable, tagKey, postAttr, []);

    // ページ数でループ
    let pageNum = 1;
    let next;

    const dlItems = [];
    const postArray = [];

    page_loop:
    while (dlItems.length < 10) {
      console.info(tagKey, pageNum);

      // 検索リクエスト
      let searchRes;

      if (pageNum > 1 && !next) {
        break page_loop;
      }

      try {
        searchRes = await searchPost(tagKey, pageNum, next, authToken);

        await waitTimer(shortPoll);
      } catch (err) {
        if (!err.response) {
          logger.error('searchPost', tagKey, pageNum, err.code);
          await waitTimer(shortPoll);
          continue page_loop;
        }

        logger.error('searchPost', tagKey, pageNum, err.response.status);

        switch (err.response.status) {
          case 401:
            try {
              authToken = await getToken();
            } catch (err) {
              logger.error('getToken', err.message);
            }
            continue page_loop;

          case 429:
            await waitTimer(longPoll);
            continue page_loop;

          case 502:
          case 503:
            await waitTimer(middlePoll);
            continue page_loop;

          default:
            await waitTimer(shortPoll);
            continue page_loop;
        }
      }

      const { data: searchData, meta: searchMeta } = searchRes;
      next = searchMeta.next;

      if (searchData && searchData.length === 0) {
        break page_loop;
      }

      // 検索結果でループ
      check_loop:
      for (let post of searchData) {
        // Post ID と拡張子の NG チェック
        const { id: postId, tag_names: tags, file_url: fileUrl } = post;
        const fileExt = (fileUrl.match(/.*\.(.*)\?.*/))[1];
        if (ngId.includes(postId) || ignoreExts.includes(fileExt)) {
          continue check_loop;
        }

        // タグの NG チェック
        for (let tag of tags) {
          if (ngText.includes(tag)) {
            continue check_loop;
          }
        }

        // 件数が 10 件になるまでレコードを配列に Push
        if (dlItems.length < 10) {
          dlItems.push(post);
          postArray.push(postId);
        }
      }

      pageNum++;
    }

    // Tag テーブルに postid の配列を追加する
    await addArrayItem(tagTable, tagKey, postAttr, postArray);

    // 既存ファイル名取得
    const exDir = path.join(typeDir, sanitize(tagKey));
    const exOkDir = path.join(typeOkDir, sanitize(tagKey));
    const exNgDir = path.join(typeNgDir, sanitize(tagKey));
    const exFiles = await walkFileSync(exDir);
    const exOkFiles = await walkFileSync(exOkDir);
    const exNgFiles = await walkFileSync(exNgDir);

    // 続行条件のチェック
    if (dlItems && dlItems.length !== 0) {
      // 検索結果でループ
      item_loop:
      for (let post of dlItems) {
        const { id: postId, file_url: fileUrl } = post;

        // ファイル名の整形
        const fileExt = (fileUrl.match(/.*\.(.*)\?.*/))[1];
        const fileName = postId + '.' + fileExt;
        const filePath = path.join(exDir, fileName);

        // ファイルの存在チェック
        if (
          exFiles.includes(fileName) ||
          exOkFiles.includes(fileName) ||
          exNgFiles.includes(fileName)
        ) {
          continue item_loop;
        }

        // ディレクトリの作成
        fs.ensureDirSync(exDir);

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
                case 503:
                  logger.error('dlContent', filePath, err.response.statusCode);

                case 404:
                  remainRetry -= 1;
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

        await waitTimer(shortPoll);
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

// メイン処理の起動
const dlType = process.argv[2];

if (dlType) {
  extraDlPosts(dlType);
} else {
  console.info('Usage: node ' + path.basename(process.argv[1]) + ' <Download Type (Ignore)>');
}
