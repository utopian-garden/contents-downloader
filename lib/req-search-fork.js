'use strict';

// 依存パッケージ
const log4js = require('log4js');
const axios = require('axios');
const sqs = require('./sqs');

// 設定ファイル
const appConfig = require('../config/app-config.json');

// ポストのコンテンツダウンロード
exports.searchPost = async (tagKey, pageNum, searchParam, authToken) => {
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

  let msgBody;
  try {
    //logger.debug('searchPost', searchUrl);
    msgBody = await axios.request(searchOptions);
  } catch(err) {
    if (err.response) {
      switch (err.response.status) {
        case 502:
        case 503:
          break;

        case 401:
          process.exitCode = 19190721;

        default:
          logger.error('searchPost', searchUrl, err.response.status);
      }
    } else {
      logger.error('searchPost', searchUrl, err.message);
    }
  }

  if (msgBody) {
    console.log(JSON.stringify(msgBody.data));
  }
}

const tagKey = process.argv[2];
const pageNum = process.argv[3];
const searchParam = process.argv[4];
const authToken = process.argv[5];

exports.searchPost(tagKey, pageNum, searchParam, authToken);
