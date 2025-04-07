// 依存パッケージ
import consoleStamp from 'console-stamp-color';
import log4js from 'log4js';
import path from 'path';

consoleStamp(console, {
  format: ':date(yyyy/mm/dd HH:MM:ss.l) :label'
});

// ライブラリ
import { searchPost, tagPut, refreshTokens } from './req.js';
import { getTokens } from './auth.js';

// 設定ファイル
import appConfig from '../config/app-config.json' with { type: 'json' };

// 定義
const { shortPoll, middlePoll, longPoll } = appConfig.req.poll;

// ポストのお気に入り処理
const tagPosts = async (procType, tagKey, searchKey, pageFeed) => {
  // 初期化
  log4js.configure('./config/tag-log-config.json');
  const logger = log4js.getLogger('system');

  // 認証リクエスト
  let accessToken, refreshToken;
  try {
    ({ accessToken, refreshToken } = await getTokens());
  } catch (err) {
    logger.error('getTokens', err.message);
    return;
  }

  // ページ数でループ
  let pageNum = 1;
  let next;
  let loop = true;

  page_loop:
  while (loop) {
    console.info(tagKey, searchKey, pageNum);

    let searchRes;

    if (pageNum > 1 && !next) {
      break page_loop;
    }

    // 検索リクエスト
    try {
      searchRes = await searchPost(searchKey, pageNum, next, accessToken);

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
            ({ accessToken, refreshToken } = await refreshTokens(refreshToken));
          } catch (err) {
            logger.error('refreshTokens', err.message);
            return;
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
      break;
    }

    // 検索結果でループ
    for (let item of searchData) {
      const { id: postId, parent_id: parentId, rating, source, tag_names } = item;
      const newTags = [];

      // Add の場合はタグを追加、Del の場合はタグを削除
      if (procType === 'Add') {
        for (let tag_name of tag_names) {
          newTags.push({ 'name': tag_name });
        }
        newTags.push({ 'name': tagKey });
      } else if (procType === 'Del') {
        for (let tag_name of tag_names) {
          if (tag_name !== tagKey) {
            newTags.push({ 'name': tag_name });
          }
        }
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
        await tagPut(postId, reqJson, accessToken);
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
              ({ accessToken, refreshToken } = await refreshTokens(refreshToken));
            } catch (err) {
              logger.error('refreshTokens', err.message);
              return;
            }
            continue page_loop;

          default:
            logger.error('tagPut', postId, err.response.status);
            await waitTimer(shortPoll);
            continue page_loop;
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
