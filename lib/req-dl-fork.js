'use strict';

// 依存パッケージ
const fs = require('fs-extra');
const log4js = require('log4js');
const axios = require('axios');
require('console-stamp-color')(console, {
  format: ':date(yyyy/mm/dd HH:MM:ss.l) :label'
});

// 設定ファイル
const appConfig = require('../config/app-config.json');

// ポストのコンテンツダウンロード
exports.dlContent = async (filePath, fileUrl, refererUrl) => {
  // 初期化
  log4js.configure('./config/download-log-config.json');
  const logger = log4js.getLogger('system');

  // リクエストパラメータ
  const userAgent = appConfig.req.common.userAgent;
  const dlOptions = {
    method: 'GET',
    url: fileUrl,
    encoding: null,
    headers: {
      'User-Agent': userAgent,
      'Referer': refererUrl
    },
    responseType: 'arraybuffer'
  };

  dl_loop:
  while (true) {
    try {
      // リクエストの実行
      const dlRes = await axios.request(dlOptions);
      fs.outputFileSync(filePath, dlRes.data);
      break dl_loop;
    } catch(err) {
      // 失敗した場合は 404 でない限りリトライ
      if (!err.response) {
        logger.error('dlContent', filePath, fileUrl, refererUrl, err.message);
        continue dl_loop;
      }

      switch (err.response.status) {
        case 404:
          break dl_loop;

        default:
          logger.error('dlContent',
              filePath, fileUrl, refererUrl, err.response.status);

          const longPoll = appConfig.req.poll.longPoll;
          await waitTimer(longPoll);

          continue dl_loop;
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

const filePath = process.argv[2];
const fileUrl = process.argv[3];
const refererUrl = process.argv[4];

exports.dlContent(filePath, fileUrl, refererUrl);
