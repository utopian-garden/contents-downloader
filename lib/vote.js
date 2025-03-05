// 依存パッケージ
import consoleStamp from 'console-stamp-color';
import log4js from 'log4js';
import path from 'path';

consoleStamp(console, {
  format: ':date(yyyy/mm/dd HH:MM:ss.l) :label'
});

// ライブラリ
import { getToken, searchPost, postVote } from './req.js';

// 設定ファイル
import appConfig from '../config/app-config.json' with { type: 'json' };

// 定義
const { shortPoll, middlePoll, longPoll } = appConfig.req.poll;

// ポストのお気に入り処理
const votePosts = async (searchKey) => {
  // 初期化
  log4js.configure('./config/vote-log-config.json');
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

  // ページ数でループ
  let pageNum = 1;
  let next;
  let loop = true;

  page_loop:
  while (loop) {
    console.info(searchKey, pageNum);

    // 検索リクエスト
    let searchRes;
    try {
      searchRes = await searchPost(searchKey, pageNum, next, authToken);

      await waitTimer(shortPoll);
    } catch (err) {
      if (!err.response) {
        logger.error('searchPost', searchKey, pageNum, err.code);
        await waitTimer(shortPoll);
        continue page_loop;
      }

      logger.error(
        'searchPost', searchKey, pageNum, err.response.status
      );

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

    // 続行条件のチェック
    if (searchData && searchData.length === 0) {
      break page_loop;
    }

    // 検索結果でループ
    for (let item of searchData) {
      const { id: postId } = item;

      console.info(postId);

      // ヒットした Post に対してタグを上書き
      try {
        const reqJson = { score: 5 };

        await postVote(postId, reqJson, authToken);
      } catch (err) {
        if (!err.response) {
          logger.error('postVote1', postId, err);
          await waitTimer(shortPoll);
          continue page_loop;
        }

        switch (err.response.status) {
          case 401:
            logger.error('postVote2', postId, err.response.status);
            try {
              authToken = await getToken();
            } catch (err) {
              logger.error('getToken', err.message);
            }
            continue page_loop;

          default:
            logger.error('postVote3', postId, err.response.status);
            await waitTimer(shortPoll);
            continue page_loop;
        }
      }
    }

    pageNum++;
  }
};

// Wait 処理
const waitTimer = (quePoll) => {
  return new Promise((resolve) => {
    setTimeout(resolve, quePoll * 1000);
  });
};

const searchKey = process.argv[2];

if (searchKey) {
  votePosts(searchKey);
} else {
  console.info('Usage: node', path.basename(process.argv[1]), '<searchKey>');
}
