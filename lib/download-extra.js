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
import ddb from './ddb.js';
import req from './req.js';
import sqs from './sqs.js';
import walk from './walk.js';

// 設定ファイル
import appConfig from '../config/app-config.json' with { type: 'json' };

// 定義
const attr = appConfig.db.attr;
const dir = appConfig.fs.dir;
const dl = appConfig.req.dl;
const ext = appConfig.fs.ext;
const msg = appConfig.mq.msg;
const ng = appConfig.ng;
const quePoll = appConfig.mq.poll;
const queUrl = appConfig.mq.url;
const reqPoll = appConfig.req.poll;
const search = appConfig.req.search;
const tab = appConfig.db.tab;

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
    case tab.igTable:
      log4js.configure('./config/dl-ig-log-config.json');
      tabName = tab.igTable;
      targetQueUrl = queUrl.igQueUrl;
      priorQueUrl = queUrl.priorIgQueUrl;
      targetQuePoll = quePoll.igQuePoll;
      typeDir = dir.igDir;
      typeOkDir = dir.igOkDir;
      typeNgDir = dir.igNgDir;
      break;

    case tab.artTable:
      log4js.configure('./config/dl-art-log-config.json');
      tabName = tab.artTable;
      targetQueUrl = queUrl.artQueUrl;
      targetQuePoll = quePoll.artQuePoll;
      priorQueUrl = queUrl.priorArtQueUrl;
      typeDir = dir.artDir;
      typeOkDir = dir.artOkDir;
      typeNgDir = dir.artNgDir;
      break;

    case tab.stuTable:
      log4js.configure('./config/dl-stu-log-config.json');
      tabName = tab.stuTable;
      targetQueUrl = queUrl.stuQueUrl;
      targetQuePoll = quePoll.stuQuePoll;
      priorQueUrl = queUrl.priorStuQueUrl;
      typeDir = dir.stuDir;
      typeOkDir = dir.stuOkDir;
      typeNgDir = dir.stuNgDir;
      break;
  }

  // 初期化
  const logger = log4js.getLogger('system');

  // 認証リクエスト
  let authToken;
  while (!authToken) {
    try {
      authToken = await req.getToken();
    } catch (err) {
      logger.error('getToken', err.message);
      await waitTimer(reqPoll.longPoll);
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
      tagMsg = await sqs.recvMsg(priorQueUrl);
    } catch (err) {
      logger.error('recvMsg', priorQueUrl, err);
      await waitTimer(targetQuePoll);
    }

    // 通常キューからメッセージを取得
    if (!tagMsg) {
      try {
        tagMsg = await sqs.recvMsg(targetQueUrl);
      } catch (err) {
        logger.error('recvMsg', targetQueUrl, err);
        await waitTimer(targetQuePoll);
      }
    }

    // メッセージを取得できない場合は後続をスキップしてメッセージ待ち
    if (!tagMsg) {
      waitCount++;

      if (waitCount === 5) {
        console.info(msg.waitingMsg);
      }

      await waitTimer(targetQuePoll);

      continue get_loop;
    }

    waitCount = 0;

    // 対象タグが DB に存在するかチェックし、存在しない場合はスキップ
    const tagKey = tagMsg.tag;
    if (ng.ngTag.includes(tagKey)) {
      continue get_loop;
    }

    let tabItems;
    try {
      tabItems = await ddb.getItem(tabName, tagKey);
    } catch (err) {
      logger.error('getItem', JSON.stringify(err));
      continue get_loop;
    }

    if (!tabItems.Item) {
      continue get_loop;
    }

    // Tag テーブルのタグの postid を削除
    await ddb.deleteItem(tab.tagTable, tagKey);
    await ddb.updateItem(tab.tagTable, tagKey, attr.postAttr, []);

    // ページ数でループ
    let pageNum = 1;

    const dlItems = [];
    const postArray = [];

    page_loop:
    while (dlItems.length < 10) {
      console.info(tagKey, pageNum);

      // 検索リクエスト
      let searchRes;

      try {
        searchRes = await req.searchPost(
          tagKey, pageNum, search.searchParam, authToken);

        await waitTimer(reqPoll.shortPoll);
      } catch (err) {
        if (!err.response) {
          logger.error('searchPost', tagKey, pageNum, err.code);
          await waitTimer(reqPoll.shortPoll);
          continue page_loop;
        }

        logger.error('searchPost', tagKey, pageNum, err.response.status);

        switch (err.response.status) {
          case 401:
            try {
              authToken = await req.getToken();
            } catch (err) {
              logger.error('getToken', err.message);
            }
            continue page_loop;

          case 429:
            await waitTimer(reqPoll.longPoll);
            continue page_loop;

          case 502:
          case 503:
            await waitTimer(reqPoll.middlePoll);
            continue page_loop;

          default:
            await waitTimer(reqPoll.shortPoll);
            continue page_loop;
        }
      }

      if (searchRes && searchRes.length === 0) {
        break page_loop;
      }

      // 検索結果でループ
      check_loop:
      for (let post of searchRes) {
        // Post ID と拡張子の NG チェック
        const fileUrl = post.file_url;
        const fileExt = (fileUrl.match(/.*\.(.*)\?.*/))[1];
        if (ng.ngId.includes(post.id) || ext.ignoreExts.includes(fileExt)) {
          continue check_loop;
        }

        // タグの NG チェック
        for (let tag of post.tags) {
          if (ng.ngText.includes(tag.tagName)) {
            continue check_loop;
          }
        }

        // 件数が 10 件になるまでレコードを配列に Push
        if (dlItems.length < 10) {
          dlItems.push(post);
          postArray.push(post.id);
        }
      }

      pageNum++;
    }

    // Tag テーブルに postid の配列を追加する
    await ddb.addArrayItem(tab.tagTable, tagKey, attr.postAttr, postArray);

    // 既存ファイル名取得
    const exDir = path.join(typeDir, sanitize(tagKey));
    const exOkDir = path.join(typeOkDir, sanitize(tagKey));
    const exNgDir = path.join(typeNgDir, sanitize(tagKey));
    const exFiles = await walk.walkFileSync(exDir);
    const exOkFiles = await walk.walkFileSync(exOkDir);
    const exNgFiles = await walk.walkFileSync(exNgDir);

    // 続行条件のチェック
    if (dlItems && dlItems.length !== 0) {
      // 検索結果でループ
      item_loop:
      for (let post of dlItems) {
        const postId = post.id;

        // ファイル名の整形
        const fileUrl = post.file_url;
        const fileExt = (fileUrl.match(/.*\.(.*)\?.*/))[1];
        const fileName = postId + '.' + fileExt;
        const filePath = path.join(exDir, fileName);

        // ファイルの存在チェック
        if (exFiles.includes(fileName) ||
          exOkFiles.includes(fileName) ||
          exNgFiles.includes(fileName)) {

          continue item_loop;
        }

        // ディレクトリの作成
        fs.ensureDirSync(exDir);

        let remainRetry = 3;

        // ダウンロード リクエスト
        dl_loop:
        while (remainRetry > 0) {
          try {
            await req.dlContent(filePath, fileUrl, dl.refererUrl);
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
                  logger.error('dlContent', filePath, fileUrl, dl.refererUrl, err.response.statusCode);
                  await waitTimer(reqPoll.shortPoll);
                  continue dl_loop;

                default:
                  remainRetry = 3;
                  logger.error('dlContent', filePath, fileUrl, dl.refererUrl, err.response.statusCode);
                  await waitTimer(reqPoll.shortPoll);
                  continue dl_loop;
              }
            } else {
              switch (err.code) {
                // エラーが発生した場合はリトライ、ただしエラーコードによっては中止
                default:
                  remainRetry = 3;
                  logger.error('dlContent', filePath, fileUrl, dl.refererUrl, err.code);
                  await waitTimer(reqPoll.shortPoll);
                  continue dl_loop;
              }
            }
          }
        }

        // ファイルサイズが 0 の場合は削除
        const tmpFilePath = filePath + '.temp';
        if (fs.existsSync(tmpFilePath)) {
          const fileSize = fs.statSync(tmpFilePath).size;
          if (fileSize === 0) {
            fs.removeSync(tmpFilePath);
          }
        }

        await waitTimer(reqPoll.shortPoll);
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
  console.info('Usage: node ' + path.basename(process.argv[1]) +
    ' <Download Type (Ignore/Artist/Studio)>');
}
