'use strict';

// 依存パッケージ
const log4js = require('log4js');
const axios = require('axios');
const sqs = require('./sqs');
const ddb = require('./ddb')
require('console-stamp')(console, { pattern: 'yyyy/mm/dd HH:MM:ss' });

// 設定ファイル
const appConfig = require('../config/app-config.json');

// ポストのコンテンツダウンロード
exports.searchPost = async (tagKey, pageNum, searchParam, authToken, curLast) => {
  // 初期化
  log4js.configure('./config/download-log-config.json');
  const logger = log4js.getLogger('system');

  const searchUrl = appConfig.req.search.searchUrl + tagKey + searchParam +
      pageNum;
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
    //logger.debug('searchPost', searchUrl);
    response = await axios.request(searchOptions);
  } catch(err) {
    if (err.response) {
      switch (err.response.status) {
        case 502:
        case 503:
          logger.error('searchPost', searchUrl, err.response.status);
          const reqPoll = appConfig.req.poll.reqPoll;
          waitTimer(reqPoll);

          break;

        case 401:
          logger.error('searchPost', searchUrl, err.response.status);
          process.exitCode = 19190721;

          break;

        default:
          logger.error('searchPost', searchUrl, err.response.status);
      }
    } else {
      logger.error('searchPost', searchUrl, err.message);
    }
  }

  let msgBody;
  if (response.data.length) {
    msgBody = {"tagKey": tagKey, "curLast": curLast, "msgData": response.data};

    for (let item of response.data) {
      if (pageNum === 1) {
        const newLast = item.id[0];
        const lastAttr = appConfig.db.attr.lastAttr;
        try {
          await ddb.updateItem(dlTable, lastAttr, tagKey, newLast);
          logger.debug('updateItem', dlTable, lastAttr, tagKey, newLast);
        } catch(err) {
          logger.error('updateItem', JSON.stringify(err));
        }
      }

      if (curLast > item.id) {
        process.exitCode = 190721;
      }
    }

    //logger.debug(response.data.length);
  } else {
    process.exitCode = 110721;
  }

  if (msgBody) {
    //logger.debug('sendMsg', (JSON.stringify(msgBody)).length);
    const searchQueUrl = appConfig.mq.url.searchQueUrl;
    try {
      await sqs.sendMsg(searchQueUrl, JSON.stringify(msgBody));
    } catch(err) {
      logger.error('sendMsg', searchQueUrl, pageNum, err.message);
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
const pageNum = process.argv[3];
const searchParam = process.argv[4];
const authToken = process.argv[5];
const curLast = process.argv[6];

exports.searchPost(tagKey, pageNum, searchParam, authToken, curLast);
