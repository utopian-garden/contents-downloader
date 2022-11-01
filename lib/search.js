'use strict';

// 依存パッケージ
const fs = require('fs-extra');
const log4js = require('log4js');
const path = require('path');
const childProcess = require('child_process');
require('console-stamp')(console, { pattern: 'yyyy/mm/dd HH:MM:ss' });

// ライブラリ
const ddb = require('./ddb');
const req = require('./req');
const sqs = require('./sqs');

// 設定ファイル
const appConfig = require('../config/app-config.json');

// ポストのダウンロード処理
exports.quePosts = async (dlType) => {
  // 初期化
  log4js.configure('./config/download-log-config.json');
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

  // ループ処理開始
  let waitCount = 0;

  search_loop:
  while (true) {
    // 優先キューからメッセージを取得
    const priorDlQueUrl = appConfig.mq.url.priorDlQueUrl;
    const dlQuePoll = appConfig.mq.poll.dlQuePoll;
    const searchQueUrl = appConfig.mq.url.searchQueUrl;
    let tagMsg;
    try {
      tagMsg = await sqs.recvMsg(priorDlQueUrl);
    } catch(err) {
      logger.error('recvMsg', priorDlQueUrl, err);
      await waitTimer(dlQuePoll);
    }

    // 通常キューからメッセージを取得
    const dlQueUrl = appConfig.mq.url.dlQueUrl;
    if (tagMsg === undefined) {
      try {
        tagMsg = await sqs.recvMsg(dlQueUrl);
      } catch(err) {
        logger.error('recvMsg', dlQueUrl, err);
        await waitTimer(dlQuePoll);
      }
    }

    // メッセージが取得できない場合は待機
    if (tagMsg === undefined) {
      const waitingMsg = appConfig.mq.msg.waitingMsg;

      if (waitCount === 0) {
        waitCount++;
        console.info(waitingMsg);
      }

      await waitTimer(dlQuePoll);
    } else {
      waitCount = 0;

      // DB の整合性チェック
      const dlTable = appConfig.db.tab.dlTable;
      const tagAttr = appConfig.db.attr.tagAttr;
      const tagKey = tagMsg.tag;
      let tabItems;
      try {
        tabItems = await ddb.queryItem(dlTable, tagAttr, tagKey);
      } catch(err) {
        logger.error('queryItem', JSON.stringify(err));
        continue;
      }

      if (tabItems.Items.length === 0) {
        continue;
      }

      // 最終更新の取得
      let curLast = tagMsg.last;
      if (curLast === undefined || dlType === 'Full') {
        curLast = 0;
      }

      // ページ数でループ
      let pageNum = 1;
      let searchQueCnt;

      page_loop:
      while (true) {
        try {
          searchQueCnt = await sqs.cntMsg(searchQueUrl);
        } catch(err) {
          logger.error('cntMsg');
          await waitTimer(dlQuePoll);
          continue page_loop;
        }

        if (searchQueCnt === 0) {
          console.info(tagKey, pageNum);

          // 検索リクエスト
          const searchParam = appConfig.req.search.searchParam;
          const options = {
            timeout: 60 * 1000
          }

          try {
            childProcess.execFileSync('node', [
                './lib/req-search-fork.js', encodeURIComponent(tagKey),
                pageNum, searchParam, authToken, curLast
              ], options);
          } catch(err) {
            if (err.status) {
              switch (err.status) {
                case 19190721:
                  logger.error('searchPost', tagKey, pageNum, err.status);
                  try {
                    authToken = await req.getToken();
                  } catch(err) {
                    logger.error('getToken', err.message);
                  }

                  break;

                case 110721:
                  continue search_loop;

                case 190721:
                  break page_loop;

                default:
                  logger.error('searchPost', tagKey, pageNum, err.status);
                  continue page_loop;
              }
            } else {
              logger.error('searchPost', tagKey, pageNum, err.message);
              continue page_loop;
            }
          }
        } else {
          await waitTimer(dlQuePoll);
          continue page_loop;
        }

        pageNum++;
      }
    }
  }
}

// Wait 処理
const waitTimer = (quePoll) => {
  return new Promise((resolve, reject) => {
    setTimeout(resolve, quePoll * 1000);
  });
};

const concurrency = 1;
const dlType = process.argv[2];

if (dlType) {
  for (let i = 0; i < concurrency; i++) {
    exports.quePosts(dlType);
  }
} else {
  console.info('Usage: node ' + path.basename(process.argv[1]) +
      ' <Download Type (Full/Diff)>');
}
