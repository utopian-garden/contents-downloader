'use strict';

// 依存パッケージ
import axios from 'axios';
import consoleStamp from 'console-stamp-color';
import log4js from 'log4js';

consoleStamp(console, {
  format: ':date(yyyy/mm/dd HH:MM:ss.l) :label'
});

// ライブラリ
import ddb from './ddb.js'
import sqs from './sqs.js';

// 設定ファイル
import appConfig from '../config/app-config.json' assert { type: 'json' };

// 定義
const attr = appConfig.db.attr;
const header = appConfig.req.header;
const exitCode = appConfig.exitCode;
const ext = appConfig.fs.ext;
const ng = appConfig.ng;
const queUrl = appConfig.mq.url;
const reqPoll = appConfig.req.poll;
const search = appConfig.req.search;
const tab = appConfig.db.tab;

// ポストのコンテンツダウンロード
const searchPost = async (tagKey, pageNum, searchParam, authToken, curLast) => {
  // 初期化
  log4js.configure('./config/download-log-config.json');
  const logger = log4js.getLogger('system');

  // リクエストパラメータ
  const searchUrl = search.searchUrl + encodeURIComponent(tagKey) + searchParam
    + pageNum;
  const searchOptions = {
    method: 'GET',
    url: searchUrl,
    headers: {
      'User-Agent': header.userAgent,
      'Authorization': authToken
    },
    timeout: reqPoll.middlePoll * 1000
  };

  let response;
  let isAuth = true;
  try {
    // 検索結果を取得
    response = await axios.request(searchOptions);

  } catch (err) {
    if (!err.response || !err.response.status) {
      logger.error('searchPost', searchUrl, err.code);
      await waitTimer(reqPoll.shortPoll);
    } else {
      logger.error('searchPost', searchUrl, err.response.status);

      switch (err.response.status) {
        case 429:
          await waitTimer(reqPoll.middlePoll);
          break;

        case 502:
        case 503:
          await waitTimer(reqPoll.middlePoll);
          break;

        case 401:
          // 401 エラーの場合はアクセストークンの再取得対象とする
          isAuth = false;
          await waitTimer(reqPoll.shortPoll);
          break;

        default:
          await waitTimer(reqPoll.shortPoll);
          break;
      }
    }
  }

  if (!isAuth) {
    process.exitCode = exitCode.unAuthCode;
    return;
  }

  // 続行条件のチェック
  if (!response || !response.data) {
    // 検索結果を取得できなかった場合はリトライ対象とする
    process.exitCode = exitCode.retryCode;
    return;
  }

  if (!response.data.length) {
    // 件数が 0 であった場合はスキップ対象とする
    process.exitCode = exitCode.nextCode;
    return;
  }

  const searchRes = response.data;
  const dlItems = [];
  const postArray = [];

  // そうでない場合は Tag テーブルの post に追加する postid を配列に追加する
  check_loop:
  for (let post of searchRes) {
    // last の値が Post ID を上回った場合はスキップ対象とする
    if (curLast >= post.id) {
      process.exitCode = exitCode.nextCode;
      break;
    }

    // Post ID と拡張子の NG チェック
    const ignoreExts = ext.ignoreExts;
    const fileUrl = post.file_url;
    const fileExt = (fileUrl.match(/.*\.(.*)\?.*/))[1];
    if (ng.ngId.includes(post.id) || ignoreExts.includes(fileExt)) {
      continue check_loop;
    }

    // タグの NG チェック
    for (let tag of post.tags) {
      if (ng.ngText.includes(tag.name_en)) {
        continue check_loop;
      }
    }

    // チェックをクリアしたらダウンロード対象として追加
    postArray.push(post.id);
    dlItems.push(post);
  }

  // Tag テーブルに postid の配列を追加する
  try {
    await ddb.addArrayItem(tab.tagTable, tagKey, attr.postAttr, postArray);
  } catch (err) {
    logger.error('addArrayItem', JSON.stringify(err));
  }

  // 1 ページ目の 1 つ目の Post ID は last としてテーブルに書き込む
  if (pageNum === 1) {
    try {
      const newLast = searchRes[0].id;
      await ddb.updateItem(tab.dlTable, tagKey, attr.lastAttr, newLast);
    } catch (err) {
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
    try {
      await sqs.sendMsg(queUrl.searchQueUrl, JSON.stringify(msgBody));
    } catch (err) {
      logger.error('sendMsg', queUrl.searchQueUrl, pageNum, err.message);
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
const pageNum = Number(process.argv[3]);
const searchParam = process.argv[4];
const authToken = process.argv[5];
const curLast = Number(process.argv[6]);

searchPost(tagKey, pageNum, searchParam, authToken, curLast);
