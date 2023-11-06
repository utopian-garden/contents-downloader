'use strict';

// 依存パッケージ
import consoleStamp from 'console-stamp-color';
import log4js from 'log4js';
import path from 'path';

consoleStamp(console, {
  format: ':date(yyyy/mm/dd HH:MM:ss.l) :label'
});

// ライブラリ
import req from './req.js';

// 設定ファイル
import appConfig from '../config/app-config.json' assert { type: 'json' };

// 定義
const reqPoll = appConfig.req.poll;
const search = appConfig.req.search;

// ポストのお気に入り処理
exports.tagPosts = async (searchKey) => {
  // 初期化
  log4js.configure('./config/get-artists-log-config.json');
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

  let artistTags = new Set();

  // ページ数でループ
  let pageNum = 1;

  page_loop:
  while (true) {
    console.info(searchKey, pageNum);

    // 検索リクエスト
    let searchRes;
    try {
      searchRes = await req.searchPost(
        searchKey, pageNum, search.searchParam, authToken);

      await waitTimer(reqPoll.shortPoll);
    } catch (err) {
      if (!err.response) {
        logger.error('searchPost', searchKey, pageNum, err.code);
        await waitTimer(reqPoll.shortPoll);
        continue page_loop;
      }

      logger.error(
        'searchPost', searchKey, pageNum, err.response.status
      );

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

    // 続行条件のチェック
    if (searchRes) {
      if (searchRes.length === 0) {
        break;
      }

      // 検索結果でループ
      for (let item of searchRes) {
        for (let tag of item.tags) {
          if (tag.type === 1) {
            artistTags.add(tag.name_en);
          }
        }
      }
    }

    pageNum++;
  }

  artistTags = Array.from(artistTags);

  for (let item of artistTags) {
    logger.debug(item);
  }
}

// Wait 処理
const waitTimer = (quePoll) => {
  return new Promise((resolve, reject) => {
    setTimeout(resolve, quePoll * 1000);
  });
};

const searchKey = process.argv[2];

if (searchKey) {
  exports.tagPosts(searchKey);
} else {
  console.info('Usage: node', path.basename(process.argv[1]),
    '<searchKey>');
}
