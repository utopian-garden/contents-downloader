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

// 定義
const header = appConfig.req.header;
const reqPoll = appConfig.req.poll;

// ポストのコンテンツダウンロード
exports.dlContent = async (filePath, fileUrl, refererUrl) => {
  // 初期化
  log4js.configure('./config/download-log-config.json');
  const logger = log4js.getLogger('system');

  // リクエストパラメータ
  const dlOptions = {
    method: 'GET',
    url: fileUrl,
    encoding: null,
    headers: {
      'User-Agent': header.userAgent,
      'Referer': refererUrl
    },
    responseType: 'arraybuffer'
  };

  // ダウンロード リクエスト
  dl_loop:
  while (true) {
    try {
      // 通常ダウンロード
      const dlRes = await axios.request(dlOptions);
      fs.outputFileSync(filePath, dlRes.data);
      break dl_loop;
    } catch(err) {
      // 失敗した場合は 403, 404, 502 でない限りリトライ
      if (!err.response) {
        logger.error('dlContent', filePath, fileUrl, refererUrl, err.message);
        await waitTimer(reqPoll.shortPoll);
        continue dl_loop;
      }

      switch (err.response.status) {
        case 403:
        case 404:
        case 502:
          break dl_loop;

        default:
          logger.error('dlContent',
              filePath, fileUrl, refererUrl, err.response.status);
          await waitTimer(reqPoll.longPoll);
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
