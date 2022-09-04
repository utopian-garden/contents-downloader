'use strict';

// 依存パッケージ
const fs = require('fs-extra');
const log4js = require('log4js');
const axios = require('axios');
require('console-stamp')(console, { pattern: 'yyyy/mm/dd HH:MM:ss' });

// 設定ファイル
const appConfig = require('../config/app-config.json');

// ポストのコンテンツダウンロード
exports.dlContent = async (filePath, fileUrl, refererUrl) => {
  // 初期化
  log4js.configure('./config/download-log-config.json');
  const logger = log4js.getLogger('system');

  const userAgent = appConfig.req.common.userAgent;
  const dlOptions = {
    method: 'GET',
    url: fileUrl,
    encoding: null,
    headers: {
      'User-Agent': userAgent,
      'Referer': refererUrl
    },
    responseType: 'arraybuffer',
    timeout: 60 * 1000
  };

  try {
    const dlRes = await axios.request(dlOptions);
    fs.outputFileSync(filePath, dlRes.data);
  } catch(err) {
    logger.error('dlContent', filePath, fileUrl, refererUrl, err.message);
  }
}

const filePath = process.argv[2];
const fileUrl = process.argv[3];
const refererUrl = process.argv[4];

exports.dlContent(filePath, fileUrl, refererUrl);
