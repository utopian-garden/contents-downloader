// 依存パッケージ
import consoleStamp from 'console-stamp-color';
import fs from 'fs-extra';
import log4js from 'log4js';
import path from 'path';

consoleStamp(console, {
  format: ':date(yyyy/mm/dd HH:MM:ss.l) :label'
});

// ライブラリ
import { getItem, updateItem, addArrayItem, deleteItem } from './ddb.js';
import { getToken, searchPost } from './req.js';
import { sendMsg, recvMsg, cntMsg } from './sqs.js';
import { syncContent } from './sync.js';

// 設定ファイル
import appConfig from '../config/app-config.json' with { type: 'json' };

// 定義
const { postAttr, lastAttr } = appConfig.db.attr;
const { ignoreExts } = appConfig.fs.ext;
const { waitingMsg } = appConfig.mq.msg;
const { ngId, ngText } = appConfig.ng;
const { dlQuePoll } = appConfig.mq.poll;
const { priorDlQueUrl, dlQueUrl, searchQueUrl } = appConfig.mq.url;
const { shortPoll, middlePoll, longPoll } = appConfig.req.poll;
const { dlTable, tagTable } = appConfig.db.tab;
const { searchQueMax } = appConfig.mq.threshold;
const { dlImageDir, dlImageOkDir, dlVideoDir, dlVideoOkDir } = appConfig.fs.dir;

// ポストのダウンロード処理
const quePosts = async (dlType) => {
  // 初期化
  log4js.configure('./config/search-log-config.json');
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

  search_loop:
  while (loop) {
    // 優先キューからメッセージを取得
    let tagMsg;
    try {
      tagMsg = await recvMsg(priorDlQueUrl);
    } catch (err) {
      logger.error('recvMsg', priorDlQueUrl, err);
      await waitTimer(dlQuePoll);
    }

    // 通常キューからメッセージを取得
    if (!tagMsg) {
      try {
        tagMsg = await recvMsg(dlQueUrl);
      } catch (err) {
        logger.error('recvMsg', dlQueUrl, err);
        await waitTimer(dlQuePoll);
      }
    }

    // メッセージを取得できない場合は後続をスキップしてメッセージ待ち
    if (!tagMsg) {
      waitCount++;

      if (waitCount === 1) {
        console.info(waitingMsg);
      }

      await waitTimer(dlQuePoll);

      continue search_loop;
    }

    waitCount = 0;

    // DB の整合性チェック
    const { tag: tagKey, last: strLast } = tagMsg;
    let tabItems;
    try {
      tabItems = await getItem(dlTable, tagKey);
    } catch (err) {
      logger.error('getItem', JSON.stringify(err));
      continue;
    }

    if (!tabItems.Item) {
      continue;
    }

    // 最終更新の取得
    let curLast = Number(strLast);
    if (!curLast || dlType === 'Full') {
      curLast = 0;
    }

    // Tag テーブルのタグの postid を削除
    if (dlType === 'Full') {
      await deleteItem(tagTable, tagKey);
      await updateItem(tagTable, tagKey, postAttr, []);
    }

    // ページ数でループ
    let pageNum = 1;
    let next;
    let searchQueCnt = 0;
    let remainRetry = 3;

    page_loop:
    while (remainRetry > 0) {
      let searchRes;

      try {
        searchQueCnt = await cntMsg(searchQueUrl);
      } catch (err) {
        logger.error('cntMsg', err);
        await waitTimer(dlQuePoll);
        continue page_loop;
      }

      if (searchQueCnt >= searchQueMax) {
        await waitTimer(dlQuePoll);
        continue page_loop;
      }

      console.info(tagKey, pageNum);

      // 検索リクエスト
      try {
        searchRes = await searchPost(tagKey, pageNum, next, authToken);
        fs.appendFileSync('log/search.txt', pageNum + ':\n');
        fs.appendFileSync('log/search.txt', JSON.stringify(searchRes) + '\n');
        await waitTimer(shortPoll);
      } catch (err) {
        if (!err.response || !err.response.status) {
          if (err.message === 'timeout of 10000ms exceeded') {
            remainRetry -= 1;
            logger.error('searchFork', tagKey, pageNum, err.message);
            continue page_loop;
          } else {
            remainRetry = 3;
            logger.error('searchFork', tagKey, pageNum, err.message);
            continue page_loop;
          }
        }

        logger.error('searchFork', tagKey, pageNum, err.response.status);

        switch (err.response.status) {
          case 401:
            // 検索が 401 エラーの場合はアクセストークンを再取得する
            remainRetry = 3;
            try {
              authToken = await getToken();
            } catch (err) {
              logger.error('getToken', err.message);
            }
            continue page_loop;

          case 429:
            // 戻り値がリトライ対象であった場合は、リトライする
            remainRetry = 3;
            await waitTimer(longPoll);
            continue page_loop;

          case 500:
            // 戻り値がキャンセル対象であった場合は、次のタグへ移行する
            remainRetry -= 1;
            await waitTimer(shortPoll);
            continue page_loop;

          case 502:
          case 503:
            // 戻り値がスキップ対象であった場合は、次のページへ移行する
            remainRetry = 3;
            await waitTimer(middlePoll);
            pageNum++;
            continue page_loop;

          default:
            remainRetry = 3;
            await waitTimer(shortPoll);
            continue page_loop;
        }
      }

      const { data: searchData, meta: searchMeta } = searchRes;
      next = searchMeta.next;

      if (searchData && searchData.length === 0) {
        break page_loop;
      }

      const dlItems = [];
      const postArray = [];
      let broken = false;

      // そうでない場合は Tag テーブルの post に追加する postid を配列に追加する
      check_loop:
      for (let post of searchData) {
        const { id: postId, file_url: fileUrl, tags } = post;

        // last の値が Post ID を上回った場合は検索結果の残りをスキップする
        if (curLast >= postId) {
          broken = true;
          break check_loop;
        }

        // Post ID と拡張子の NG チェック
        const fileExt = (fileUrl.match(/.*\.(.*)\?.*/))[1];
        if (ngId.includes(postId) || ignoreExts.includes(fileExt)) {
          continue check_loop;
        }

        // タグの NG チェック
        for (let tag of tags) {
          const { tagName } = tag;
          if (ngText.includes(tagName)) {
            continue check_loop;
          }
        }

        // チェックをクリアしたらダウンロード対象として追加
        postArray.push(postId);
        dlItems.push(post);
      }

      // Tag テーブルに postid の配列を追加する (フルダウンロードの場合のみ)
      if (dlType === 'Full') {
        try {
          await addArrayItem(tagTable, tagKey, postAttr, postArray);
        } catch (err) {
          logger.error('addArrayItem', JSON.stringify(err));
        }
      }

      // 1 ページ目の 1 つ目の Post ID は last としてテーブルに書き込む
      if (pageNum === 1) {
        try {
          const newLast = searchData[0].id;
          await updateItem(dlTable, tagKey, lastAttr, newLast);
        } catch (err) {
          logger.error('updateItem', JSON.stringify(err));
        }
      }

      // 検索結果をリクエストキューに送信する
      const searchMsgBody = {
        tagKey: tagKey,
        pageNum: pageNum,
        curLast: curLast,
        msgData: dlItems
      };

      if (searchMsgBody) {
        try {
          await sendMsg(searchQueUrl, JSON.stringify(searchMsgBody));
        } catch (err) {
          logger.error('sendMsg', searchQueUrl, pageNum, err.message);
        }
      }

      // last の値が Post ID を上回っている場合はページの残りをスキップする
      if (broken) {
        break page_loop;
      }

      pageNum++;
    }

    // 途中でキャンセルした場合はコンテンツの同期はしない
    if (remainRetry === 0) {
      continue search_loop;
    }

    // DB スキャン
    const tagItem = await getItem(tagTable, tagKey);
    const { post: tagPosts } = tagItem.Item;

    // タグのレコードがない場合はスキップ
    if (tagPosts.length === 0) {
      continue search_loop;
    }

    // コンテンツの同期開始
    const syncDirs = [dlImageDir, dlVideoDir, dlImageOkDir, dlVideoOkDir];
    await syncContent(tagKey, syncDirs, tagPosts);
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
  quePosts(dlType);
} else {
  console.info('Usage: node ' + path.basename(process.argv[1]) + ' <Download Type (Full/Diff)>');
}
