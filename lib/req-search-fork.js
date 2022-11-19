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

  const searchUrl = appConfig.req.search.searchUrl +
      encodeURIComponent(tagKey) + searchParam + pageNum;
  const userAgent = appConfig.req.common.userAgent;
  const searchOptions = {
    method: 'GET',
    url: searchUrl,
    headers: {
      'User-Agent': userAgent,
      'Authorization': authToken
    }
  };

  let response;
  try {
    response = await axios.request(searchOptions);

    let msgBody;
    if (response && response.data && response.data.length) {
      msgBody = {
        "tagKey": tagKey,
        "pageNum": pageNum,
        "curLast": curLast,
        "msgData": response.data
      };

      for (let item of response.data) {
        if (curLast >= item.id) {
          process.exitCode = 190721;
        }
      }

      if (pageNum === 1) {
        try {
          const dlTable = appConfig.db.tab.dlTable;
          const newLast = response.data[0].id;
          const lastAttr = appConfig.db.attr.lastAttr;
          await ddb.updateItem(dlTable, lastAttr, tagKey, newLast);
        } catch(err) {
          logger.error('updateItem', JSON.stringify(err));
        }
      }
    } else {
      process.exitCode = 110721;
    }

    if (msgBody) {
      const searchQueUrl = appConfig.mq.url.searchQueUrl;
      try {
        await sqs.sendMsg(searchQueUrl, JSON.stringify(msgBody));
      } catch(err) {
        logger.error('sendMsg', searchQueUrl, pageNum, err.message);
      }
    }
  } catch(err) {
    if (!err.response) {
      logger.error('searchPost', searchUrl, err.message);
    }

    switch (err.response.status) {
      case 429:
      case 502:
      case 503:
        logger.error('searchPost', searchUrl, err.response.status);
        const longPoll = appConfig.req.poll.longPoll;
        waitTimer(longPoll);

        break;

      case 401:
        logger.error('searchPost', searchUrl, err.response.status);
        process.exitCode = 19190721;

        break;

      default:
        logger.error('searchPost', searchUrl, err.response.status);
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

exports.searchPost(tagKey, pageNum, searchParam, authToken, curLast);
