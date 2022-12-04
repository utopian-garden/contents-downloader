'use strict';

// 依存パッケージ
const log4js = require('log4js');
const axios = require('axios');
require('console-stamp-color')(console, {
  format: ':date(yyyy/mm/dd HH:MM:ss.l) :label'
});

// ライブラリ
const sqs = require('./sqs');
const ddb = require('./ddb')

// 設定ファイル
const appConfig = require('../config/app-config.json');

// ポストのコンテンツダウンロード
exports.searchPost = async (tagKey, pageNum, searchParam, authToken, curLast) => {
  // 初期化
  log4js.configure('./config/download-log-config.json');
  const logger = log4js.getLogger('system');

  // リクエストパラメータ
  const searchUrl = appConfig.req.search.searchUrl +
      encodeURIComponent(tagKey) + searchParam + pageNum;
  const userAgent = appConfig.req.common.userAgent;

  const shortPoll = appConfig.req.poll.shortPoll;
  const middlePoll = appConfig.req.poll.middlePoll;
  const longPoll = appConfig.req.poll.longPoll;
  const searchOptions = {
    method: 'GET',
    url: searchUrl,
    headers: {
      'User-Agent': userAgent,
      'Authorization': authToken
    },
    timeout: middlePoll * 1000
  };

  let response;
  try {
    // 検索結果を取得
    response = await axios.request(searchOptions);

  } catch(err) {
    if (!err.response) {
      logger.error('searchPost', searchUrl, err.message);
    }

    logger.error('searchPost', searchUrl, err.response.status);

    switch (err.response.status) {
      case 429:
        waitTimer(longPoll);

        break;

      case 502:
      case 503:
        waitTimer(middlePoll);

        break;

      case 401:
        // 401 エラーの場合はアクセストークンの再取得対象とする
        process.exitCode = 19190721;

        break;

      default:
        await waitTimer(shortPoll);
        break;
    }
  }

  // 続行条件のチェック
  if (response && response.data && response.data.length) {
    const searchRes = response.data;
    const dlItems = [];
    const postArray = [];

    // そうでない場合は Tag テーブルの post に追加する postid を配列に追加する
    check_loop:
    for (let post of searchRes) {
      // last の値が Post ID を上回った場合はスキップ対象とする
      if (curLast >= post.id) {
        process.exitCode = 190721
        break;
      }

      // Post ID と拡張子の NG チェック
      const ngId = appConfig.ng.ngId;
      const ignoreExts = appConfig.fs.ignoreExts;
      const fileUrl = post.file_url;
      const fileExt = (fileUrl.match(/.*\.(.*)\?.*/))[1];
      if (ngId.includes(post.id) || ignoreExts.includes(fileExt)) {
        continue check_loop;
      }

      // タグの NG チェック
      for (let tag of post.tags) {
        const ngText = appConfig.ng.ngText;
        if (ngText.includes(tag.name_en)) {
          continue check_loop;
        }
      }

      // チェックをクリアしたらダウンロード対象として追加
      postArray.push(post.id);
      dlItems.push(post);
    }

    // Tag テーブルに postid の配列を追加する
    const tagTable = appConfig.db.tab.tagTable;
    const postAttr = appConfig.db.attr.postAttr;
    await ddb.addArrayItem(tagTable, tagKey, postAttr, postArray);

    // 1 ページ目の 1 つ目の Post ID は last としてテーブルに書き込む
    if (pageNum === 1) {
      try {
        const dlTable = appConfig.db.tab.dlTable;
        const newLast = searchRes[0].id;
        const lastAttr = appConfig.db.attr.lastAttr;
        await ddb.updateItem(dlTable, tagKey, lastAttr, newLast);
      } catch(err) {
        logger.error('updateItem', JSON.stringify(err));
      }
    }

    // 検索結果をリクエストキューに送信する
    const msgBody = {
      "tagKey": tagKey,
      "pageNum": pageNum,
      "curLast": curLast,
      "msgData": dlItems
    };

    if (msgBody) {
      const searchQueUrl = appConfig.mq.url.searchQueUrl;
      try {
        await sqs.sendMsg(searchQueUrl, JSON.stringify(msgBody));
      } catch(err) {
        logger.error('sendMsg', searchQueUrl, pageNum, err.message);
      }
    }
  } else {
    // 検索結果を取得できなかった場合はリトライ対象とする
    process.exitCode = 110721;
  }
}

// Wait 処理
const waitTimer = (quePoll) => {
  return new Promise((resolve, reject) => {
    setTimeout(resolve, quePoll * 1000);
  });
};

const tagKey = process.argv[2];
const pageNum = Number(process.argv[3]);
const searchParam = process.argv[4];
const authToken = process.argv[5];
const curLast = Number(process.argv[6]);

exports.searchPost(tagKey, pageNum, searchParam, authToken, curLast);
