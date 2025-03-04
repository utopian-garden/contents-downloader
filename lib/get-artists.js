// 依存パッケージ
import consoleStamp from 'console-stamp-color';
import fs from 'fs-extra';
import log4js from 'log4js';
import path from 'path';

consoleStamp(console, {
  format: ':date(yyyy/mm/dd HH:MM:ss.l) :label'
});

// ライブラリ
import { getToken, v2SearchPost } from './req.js';

// 設定ファイル
import appConfig from '../config/app-config.json' with { type: 'json' };

// 定義
const { shortPoll, middlePoll, longPoll } = appConfig.req.poll;

// ポストのお気に入り処理
const tagPosts = async (tagKey) => {
  // 初期化
  log4js.configure('./config/get-artists-log-config.json');
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

  let artistTags = new Set();
  let studioTags = new Set();

  // ページ数でループ
  let pageNum = 1;
  let next;
  let loop = true;

  page_loop:
  while (loop) {
    console.info(tagKey, pageNum);

    // 検索リクエスト
    let searchRes;

    if (pageNum > 1 && !next) {
      break page_loop;
    }

    try {
      searchRes = await v2SearchPost(tagKey, pageNum, next, authToken);

      await waitTimer(shortPoll);
    } catch (err) {
      if (!err.response || !err.response.status) {
        if (err.message === 'timeout of 10000ms exceeded') {
          logger.error('v2SearchPost', tagKey, pageNum, err.message);
          continue page_loop;
        } else {
          logger.error('v2SearchPost', tagKey, pageNum, err.message);
          continue page_loop;
        }
      }

      logger.error('v2SearchPost', tagKey, pageNum, err.response.status);

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
          logger.error('getToken', err.message);
          continue page_loop;

        case 500:
          await waitTimer(shortPoll);
          logger.error('getToken', err.message);
          continue page_loop;

        case 502:
        case 503:
          await waitTimer(middlePoll);
          logger.error('getToken', err.message);
          continue page_loop;

        default:
          await waitTimer(shortPoll);
          logger.error('getToken', err.message);
          continue page_loop;
      }
    }

    const { data: searchData, meta: searchMeta } = searchRes;
    next = searchMeta.next;

    if (searchData && searchData.length === 0) {
      break page_loop;
    }

    // 続行条件のチェック
    if (searchData) {
      if (searchData.length === 0) {
        break page_loop;
      }

      // 検索結果でループ
      for (let item of searchData) {
        for (let tag of item.tags) {
          if (tag.type === 1) {
            artistTags.add(tag.tagName);
          } else if (tag.type === 2) {
            studioTags.add(tag.tagName);
          }
        }
      }
    }

    pageNum++;
  }

  try {
    artistTags.forEach(artist => {
      fs.appendFileSync('log/get-artists.txt', `${artist}\n`);
    });

    studioTags.forEach(studio => {
      fs.appendFileSync('log/get-studios.txt', `${studio}\n`);
    });
  } catch (err) {
    logger.error('tagPosts', err.message);
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
  tagPosts(searchKey);
} else {
  console.info('Usage: node', path.basename(process.argv[1]),
    '<searchKey>');
}