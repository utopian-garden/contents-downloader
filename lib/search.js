'use strict';

// 依存パッケージ
const log4js = require('log4js');
const path = require('path');
const childProcess = require('child_process');
require('console-stamp-color')(console, {
  format: ':date(yyyy/mm/dd HH:MM:ss.l) :label'
});

// ライブラリ
const ddb = require('./ddb');
const req = require('./req');
const sqs = require('./sqs');

// 設定ファイル
const appConfig = require('../config/app-config.json');

// 定義
const attr = appConfig.db.attr;
const exitCode = appConfig.exitCode;
const msg = appConfig.mq.msg;
const quePoll = appConfig.mq.poll;
const queUrl = appConfig.mq.url;
const reqPoll = appConfig.req.poll;
const search = appConfig.req.search;
const tab = appConfig.db.tab;
const threshold = appConfig.mq.threshold;

// ポストのダウンロード処理
exports.quePosts = async (dlType) => {
  // 初期化
  log4js.configure('./config/download-log-config.json');
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

  // ループ処理開始
  let waitCount = 0;

  search_loop:
  while (true) {
    // 優先キューからメッセージを取得
    let tagMsg;
    try {
      tagMsg = await sqs.recvMsg(queUrl.priorDlQueUrl);
    } catch (err) {
      logger.error('recvMsg', queUrl.priorDlQueUrl, err);
      await waitTimer(quePoll.dlQuePoll);
    }

    // 通常キューからメッセージを取得
    const dlQueUrl = queUrl.dlQueUrl;
    if (!tagMsg) {
      try {
        tagMsg = await sqs.recvMsg(dlQueUrl);
      } catch (err) {
        logger.error('recvMsg', dlQueUrl, err);
        await waitTimer(quePoll.dlQuePoll);
      }
    }

    // メッセージを取得できない場合は後続をスキップしてメッセージ待ち
    if (!tagMsg) {
      waitCount++;

      if (waitCount === 1) {
        console.info(msg.waitingMsg);
      }

      await waitTimer(quePoll.dlQuePoll);

      continue search_loop;
    }

    waitCount = 0;

    // DB の整合性チェック
    const tagKey = tagMsg.tag;
    let tabItems;
    try {
      tabItems = await ddb.getItem(tab.dlTable, tagKey);
    } catch (err) {
      logger.error('getItem', JSON.stringify(err));
      continue;
    }

    if (!tabItems.Item) {
      continue;
    }

    // 最終更新の取得
    let curLast = Number(tagMsg.last);
    if (!curLast || dlType === 'Full') {
      curLast = 0;
    }

    // Tag テーブルのタグの postid を削除
    if (dlType === 'Full') {
      await ddb.deleteItem(tab.tagTable, tagKey);
      await ddb.updateItem(tab.tagTable, tagKey, attr.postAttr, []);
    }

    // ページ数でループ
    let pageNum = 1;
    let searchQueCnt = 0;

    page_loop:
    while (true) {
      try {
        searchQueCnt = await sqs.cntMsg(queUrl.searchQueUrl);
      } catch (err) {
        logger.error('cntMsg');
        await waitTimer(quePoll.dlQuePoll);
        continue page_loop;
      }

      if (searchQueCnt >= threshold.searchQueMax) {
        await waitTimer(quePoll.dlQuePoll);
        continue page_loop;
      }

      console.info(tagKey, pageNum);

      // 検索リクエスト
      const options = {
        timeout: 60 * 1000
      }

      try {
        childProcess.execFileSync('node', ['./lib/req-search-fork.js',
          tagKey, pageNum, search.searchParam, authToken, curLast], options);

        await waitTimer(reqPoll.shortPoll);
      } catch (err) {
        if (!err.status) {
          logger.error('searchFork', tagKey, pageNum, err.message);
          continue page_loop;
        }

        switch (err.status) {
          case exitCode.unAuthCode:
            // 検索が 401 エラーの場合はアクセストークンを再取得する
            logger.error('searchFork', tagKey, pageNum, err.status);
            try {
              authToken = await req.getToken();
            } catch (err) {
              logger.error('getToken', err.message);
            }

            continue page_loop;

          case exitCode.retryCode:
            // 戻り値がリトライ対象であった場合は、リトライする
            continue page_loop;

          case exitCode.nextCode:
            // 戻り値がスキップ対象であった場合は、次のタグへ移行する
            break page_loop;

          default:
            logger.error('searchFork', tagKey, pageNum, err.status);
            continue page_loop;
        }
      }

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

const dlType = process.argv[2];

if (dlType) {
  exports.quePosts(dlType);
} else {
  console.info('Usage: node ' + path.basename(process.argv[1]) +
    ' <Download Type (Full/Diff)>');
}
