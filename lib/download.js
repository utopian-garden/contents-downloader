'use strict';

// 依存パッケージ
const fs = require('fs-extra');
const log4js = require('log4js');
const path = require('path');
const sanitize = require('sanitize-filename');
const childProcess = require('child_process');
require('console-stamp-color')(console, {
  format: ':date(yyyy/mm/dd HH:MM:ss.l) :label'
});

// ライブラリ
const sqs = require('./sqs');
const walk = require('./walk');

// 設定ファイル
const appConfig = require('../config/app-config.json');

// ポストのダウンロード処理
exports.dlPosts = async () => {
  // 初期化
  log4js.configure('./config/download-log-config.json');
  const logger = log4js.getLogger('system');

  // ループ処理の開始
  let waitCount = 0;

  get_loop:
  while (true) {
    // 通常キューからメッセージを取得
    const searchQueUrl = appConfig.mq.url.searchQueUrl;
    let searchQueRes;
    try {
      searchQueRes = await sqs.recvMsg(searchQueUrl);
    } catch(err) {
      logger.error('recvMsg', searchQueUrl, err);
      continue get_loop;
    }

    // メッセージを取得できない場合は後続をスキップしてメッセージ待ち
    if (!searchQueRes) {
      waitCount++;

      if (waitCount === 60) {
        const waitingMsg = appConfig.mq.msg.waitingMsg;
        console.info(waitingMsg);
      }
      const dlQuePoll = appConfig.mq.poll.dlQuePoll;
      await waitTimer(dlQuePoll);

      continue get_loop;
    }

    waitCount = 0;
    const tagKey = decodeURIComponent(searchQueRes.tagKey);
    const saniTagKey = sanitize(tagKey);

    // 既存ファイル名の取得
    const dlImageDir = path.join(appConfig.fs.dlImageDir, saniTagKey);
    const dlImageOkDir = path.join(appConfig.fs.dlImageOkDir, saniTagKey);
    const dlImageFiles = await walk.walkFileSync(dlImageDir);
    const dlImageOkFiles = await walk.walkFileSync(dlImageOkDir);

    const dlVideoDir = path.join(appConfig.fs.dlVideoDir, saniTagKey);
    const dlVideoOkDir = path.join(appConfig.fs.dlVideoOkDir, saniTagKey);
    const dlVideoFiles = await walk.walkFileSync(dlVideoDir);
    const dlVideoOkFiles = await walk.walkFileSync(dlVideoOkDir);

    // 続行条件のチェック
    const dlItems = searchQueRes.msgData;
    if (!dlItems) {
      continue get_loop;
    }

    const pageNum = Number(searchQueRes.pageNum);
    console.info(tagKey, pageNum);

    // 検索結果でループ
    item_loop:
    for (let post of dlItems) {
      const postId = post.id;

      // ファイル名の整形
      const fileUrl = post.file_url;
      const fileExt = (fileUrl.match(/.*\.(.*)\?.*/))[1];
      const fileName = postId + '.' + fileExt;

      // ダウンロード先の仕分け
      let dlDir;
      const imageExts = appConfig.fs.imageExts;
      if (imageExts.includes(fileExt)) {
        dlDir = dlImageDir;
      } else {
        dlDir = dlVideoDir;
      }

      const filePath = path.join(dlDir, fileName);

      // ファイルの存在チェック
      if (dlImageFiles.includes(fileName) ||
          dlImageOkFiles.includes(fileName) ||
          dlVideoFiles.includes(fileName) ||
          dlVideoOkFiles.includes(fileName)) {

        continue item_loop;
      }

      // ディレクトリの作成
      fs.ensureDirSync(dlDir);

      // テンプレートファイルの配布
      const toolDir = appConfig.fs.toolDir;
      const orderBat = appConfig.fs.orderBat;
      const orderPs1 = appConfig.fs.orderPs1;
      const orderLst = appConfig.fs.orderLst;
      const batFrom = path.join(toolDir, orderBat);
      const batTo = path.join(dlDir, orderBat);
      const ps1From = path.join(toolDir, orderPs1);
      const ps1To = path.join(dlDir, orderPs1);
      const lstFrom = path.join(toolDir, orderLst);
      const lstTo = path.join(dlDir, orderLst);

      if (!fs.pathExistsSync(batTo)) {
        fs.copySync(batFrom, batTo);
      }

      if (!fs.pathExistsSync(ps1To)) {
        fs.copySync(ps1From, ps1To);
      }
      if (!fs.pathExistsSync(lstTo)) {
        fs.copySync(lstFrom, lstTo);
      }

      // ダウンロード リクエスト
      const refererUrl = appConfig.req.dl.refererUrl + postId;
      try {
        childProcess.execFileSync('node', ['./lib/req-dl-fork.js',
            filePath, fileUrl, refererUrl]);
      } catch(err) {
        logger.error('dlFork', err.message);
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

exports.dlPosts();
