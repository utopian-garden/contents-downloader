// 依存パッケージ
import consoleStamp from 'console-stamp-color';
import log4js from 'log4js';
import path from 'path';

consoleStamp(console, {
  format: ':date(yyyy/mm/dd HH:MM:ss.l) :label'
});

// ライブラリ
import { getToken, searchPost, tagPut } from './req.js';

// 設定ファイル
import appConfig from '../config/app-config.json' with { type: 'json' };

// 定義
const { shortPoll, middlePoll, longPoll } = appConfig.req.poll;
const { searchParam } = appConfig.req.search;

// ポストのお気に入り処理
const tagPosts = async (procType, tagKey, searchKey, pageFeed) => {
  // 初期化
  log4js.configure('./config/tag-log-config.json');
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
  let loop = true;

  page_loop:
  while (loop) {
    console.info(tagKey, searchKey, pageNum);

    // 検索リクエスト
    let searchRes;
    try {
      searchRes = await searchPost(searchKey, pageNum, searchParam, authToken);

      await waitTimer(shortPoll);
    } catch (err) {
      if (!err.response) {
        logger.error('searchPost', tagKey, searchKey, pageNum, err.code);
        await waitTimer(shortPoll);
        continue page_loop;
      }

      logger.error(
        'searchPost', tagKey, searchKey, pageNum, err.response.status
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

    const { data: searchData } = searchRes;

    // 続行条件のチェック
    if (searchData) {
      if (searchData.length === 0) {
        break;
      }

      // 検索結果でループ
      for (let item of searchData) {
        const { id: postId, parent_id: parentId, rating, source, tags } = item;
        const newTags = [];

        // Add の場合はタグを追加、Del の場合はタグを削除
        if (procType === 'Add') {
          tags.map(row => {
            newTags.push({ 'name': row['name'] });
          });
          newTags.push({ 'name': tagKey });
        } else if (procType === 'Del') {
          tags.map(row => {
            if (row['name'] !== tagKey) {
              newTags.push({ 'name': row['name'] });
            }
          });
        }

        const reqJson = {
          id: postId,
          post: {
            lang: 'en',
            parent_id: parentId,
            rating: rating,
            source: source,
            tags: newTags
          }
        };

        console.info(postId);

        // ヒットした Post に対してタグを上書き
        try {
          await tagPut(postId, reqJson, authToken);
        } catch (err) {
          if (!err.response) {
            logger.error('tagPut', postId, err.code);
            await waitTimer(shortPoll);
            continue page_loop;
          }

          switch (err.response.status) {
            case 401:
              logger.error('tagPut', postId, err.response.status);
              try {
                authToken = await getToken();
              } catch (err) {
                logger.error('getToken', err.message);
              }
              continue page_loop;

            default:
              logger.error('tagPut', postId, err.response.status);
              await waitTimer(shortPoll);
              continue page_loop;
          }
        }
      }
    }

    if (pageFeed === 'on') {
      pageNum++;
    }
  }
};

// Wait 処理
const waitTimer = (quePoll) => {
  return new Promise((resolve) => {
    setTimeout(resolve, quePoll * 1000);
  });
};

const procType = process.argv[2];
const tagKey = process.argv[3];
const searchKey = process.argv[4];
const pageFeed = process.argv[5];

if (procType && tagKey && searchKey && pageFeed) {
  tagPosts(procType, tagKey, searchKey, pageFeed);
} else {
  console.info('Usage: node', path.basename(process.argv[1]),
    '<process(Add/Del)><tagKey> <searchKey> <feed(on/off)>');
}
