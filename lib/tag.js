'use strict';

// 依存パッケージ
const log4js = require('log4js');
const path = require('path');
require('console-stamp-color')(console, {
  format: ':date(yyyy/mm/dd HH:MM:ss.l) :label'
});

// ライブラリ
const req = require('./req');

// 設定ファイル
const appConfig = require('../config/app-config.json');

// 定義
const reqPoll = appConfig.req.poll;

const searchParam = appConfig.req.search.searchParam;

// ポストのお気に入り処理
exports.tagPosts = async (procType, tagKey, searchKey, pageFeed) => {
  // 初期化
  log4js.configure('./config/tag-log-config.json');
  const logger = log4js.getLogger('system');

  // 認証リクエスト
  let authToken;
  while (!authToken) {
    try {
      authToken = await req.getToken();
    } catch(err) {
      logger.error('getToken', err.message);
      await waitTimer(reqPoll.longPoll);
    }
  }

  // ページ数でループ
  let pageNum = 1;

  page_loop:
  while (true) {
    console.info(tagKey, searchKey, pageNum);

    // 検索リクエスト
    let searchRes;
    try {
      searchRes = await req.searchPost(
          searchKey, pageNum, searchParam, authToken);

      await waitTimer(reqPoll.shortPoll);
    } catch(err) {
      if (!err.response) {
        logger.error('searchPost', tagKey, searchKey, pageNum, err.message);
        await waitTimer(reqPoll.shortPoll);
        continue page_loop;
      }

      logger.error(
        'searchPost', tagKey, searchKey, pageNum, err.response.status
      );

      switch (err.response.status) {
        case 401:
          try {
            authToken = await req.getToken();
          } catch(err) {
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
        const postId = item.id;
        const parentId = item.parent_id;
        const rating = item.rating;
        const source = item.source;
        const tags = item.tags;
        const newTags = [];

        // Add の場合はタグを追加、Del の場合はタグを削除
        if (procType === 'Add') {
          tags.map(row => {
            newTags.push({"name": row["name"]});
          });
          newTags.push({"name": tagKey});
        } else if (procType === 'Del') {
          tags.map(row => {
            if (row["name"] !== tagKey) {
              newTags.push({"name": row["name"]});
            }
          });
        }

        const reqJson = {
          "id": postId,
          "post": {
            "lang": "en",
            "parent_id": parentId,
            "rating": rating,
            "source": source,
            "tags": newTags
          }
        };

        console.info(postId);

        // ヒットした Post に対してタグを上書き
        try {
          await req.tagPut(postId, reqJson, authToken);
        } catch(err) {
          if (!err.response) {
            logger.error('tagPut', postId, err.message);
            await waitTimer(reqPoll.shortPoll);
            continue page_loop;
          }

          switch (err.response.status) {
            case 401:
              logger.error('tagPut', postId, err.response.status);
              try {
                authToken = await req.getToken();
              } catch(err) {
                logger.error('getToken', err.message);
              }
              continue page_loop;

            default:
              logger.error('tagPut', postId, err.response.status);
              await waitTimer(reqPoll.shortPoll);
              continue page_loop;
          }
        }
      }
    }

    if (pageFeed === "on") {
      pageNum++;
    }
  }
}

// Wait 処理
const waitTimer = (quePoll) => {
  return new Promise((resolve, reject) => {
    setTimeout(resolve, quePoll * 1000);
  });
};

const procType = process.argv[2];
const tagKey = process.argv[3];
const searchKey = process.argv[4];
const pageFeed = process.argv[5];

if (procType && tagKey && searchKey && pageFeed) {
  exports.tagPosts(procType, tagKey, searchKey, pageFeed);
} else {
  console.info('Usage: node', path.basename(process.argv[1]),
      '<process(Add/Del)><tagKey> <searchKey> <feed(on/off)>');
}
