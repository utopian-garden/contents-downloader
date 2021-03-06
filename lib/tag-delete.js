'use strict';

// 依存パッケージ
const log4js = require('log4js');
const path = require('path');
require('console-stamp')(console, { pattern: 'yyyy/mm/dd HH:MM:ss' });

// ライブラリ
const req = require('./req');

// 設定ファイル
const appConfig = require('../config/app-config.json');

// ポストのお気に入り処理
exports.tagPosts = async (tagKey, searchKey, pageFeed) => {
  // 初期化
  log4js.configure('../config/tag-del-log-config.json');
  const logger = log4js.getLogger('system');

  // 認証リクエスト
  const reqPoll = appConfig.req.poll.reqPoll;
  let authToken;
  while (!authToken) {
    try {
      authToken = await req.getToken();
    } catch(err) {
      logger.error('getToken', err.message);
      await waitTimer(reqPoll);
    }
  }

  // ページ数でループ
  let pageNum = 1;

  page_loop:
  while (true) {
    console.info(tagKey, searchKey, pageNum);

    // 検索リクエスト
    const searchParam = appConfig.req.search.searchParam;
    let searchRes;
    try {
      searchRes = await req.searchPost(encodeURI(searchKey), pageNum,
          searchParam, authToken);
    } catch(err) {
      if (err.response) {
        switch (err.response.status) {
          case 401:
            console.error('searchPost', tagKey, searchKey, pageNum, err.response.status);
            try {
              authToken = await req.getToken();
            } catch(err) {
              logger.error('getToken', err.message);
            }
            continue page_loop;

          case 400:
          case 408:
          case 504:
            logger.error('searchPost', tagKey, searchKey, pageNum, err.response.status);
            break page_loop;

          case 502:
            console.error('searchPost', tagKey, searchKey, pageNum, err.response.status);
            await waitTimer(reqPoll);
            continue page_loop;

          default:
            logger.error('searchPost', tagKey, searchKey, pageNum, err.response.status);
            continue page_loop;
        }
      } else {
        logger.error('searchPost', tagKey, searchKey, pageNum, err.message);
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
        let newTags = [];
        tags.map(row => {
          if (row["name"] !== tagKey) {
            newTags.push({"name": row["name"]});
          }
        });
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

        // お気に入りリクエスト
        try {
          await req.tagPut(postId, reqJson, authToken);
        } catch(err) {
          if (err.response) {
            switch (err.response.status) {
              case 401:
                console.error('tagPut', postId, err.response.status);
                try {
                  authToken = await req.getToken();
                } catch(err) {
                  logger.error('getToken', err.message);
                }
                continue page_loop;

              default:
                logger.error('tagPut', postId, err.response.status);
                continue page_loop;
            }
          } else {
            logger.error('tagPut', postId, err.message);
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

const tagKey = process.argv[2];
const searchKey = process.argv[3];
const pageFeed = process.argv[4];

if (tagKey && searchKey && pageFeed) {
  exports.tagPosts(tagKey, searchKey);
} else {
  console.info('Usage: node ' + path.basename(process.argv[1]) +
      ' <tagKey> <searchKey> <feed(on/off)>');
}
