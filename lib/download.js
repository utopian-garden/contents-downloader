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

  let waitCount = 0;

  get_loop:
  while (true) {
    const dlQuePoll = appConfig.mq.poll.dlQuePoll;

    const searchQueUrl = appConfig.mq.url.searchQueUrl;
    let searchQueRes;
    try {
      searchQueRes = await sqs.recvMsg(searchQueUrl);
    } catch(err) {
      logger.error('recvMsg', searchQueUrl, err);
      continue get_loop;
    }

    if (!searchQueRes) {
      waitCount++;

      if (waitCount === 60) {
        const waitingMsg = appConfig.mq.msg.waitingMsg;
        console.info(waitingMsg);
      }

      await waitTimer(dlQuePoll);

      continue get_loop;
    }

    waitCount = 0;
    const tagKey = decodeURIComponent(searchQueRes.tagKey);

    // 既存ファイル名の取得
    const dlImageDir = path.join(appConfig.fs.dlImageDir, sanitize(tagKey));
    const dlImageOkDir = path.join(appConfig.fs.dlImageOkDir, sanitize(tagKey));
    const dlImageFiles = await walk.walkFileSync(dlImageDir);
    const dlImageOkFiles = await walk.walkFileSync(dlImageOkDir);

    const dlVideoDir = path.join(appConfig.fs.dlVideoDir, sanitize(tagKey));
    const dlVideoOkDir = path.join(appConfig.fs.dlVideoOkDir, sanitize(tagKey));
    const dlVideoFiles = await walk.walkFileSync(dlVideoDir);
    const dlVideoOkFiles = await walk.walkFileSync(dlVideoOkDir);

    // 続行条件のチェック
    const searchRes = searchQueRes.msgData;
    if (!searchRes) {
      continue get_loop;
    }

    const pageNum = searchQueRes.pageNum;
    console.info(tagKey, Number(pageNum));

    // 検索結果でループ
    item_loop:
    for (let item of searchRes) {
      const postId = item.id;
      const curLast = searchQueRes.curLast;
      if (curLast > postId) {
        break;
      }

      // ファイル名の整形
      const fileUrl = item.file_url;
      const fileExt = (fileUrl.match(/.*\.(.*)\?.*/))[1];
      const fileName = postId + '.' + fileExt;

      // NG ワードチェック
      for (let tag of item.tags) {
        const ngText = appConfig.ng.ngText;
        if (ngText.includes(tag.name_en)) {
          if (dlImageFiles.includes(fileName) ||
              dlImageOkFiles.includes(fileName) ||
              dlVideoFiles.includes(fileName) ||
              dlVideoOkFiles.includes(fileName)) {

            //logger.debug('deleteNg', tagKey, fileName);

            fs.removeSync(path.join(dlImageDir, fileName));
            fs.removeSync(path.join(dlImageDir, "image", fileName));
            fs.removeSync(path.join(dlImageDir, "image", "ok", fileName));
            fs.removeSync(path.join(dlImageOkDir, fileName));
            fs.removeSync(path.join(dlImageOkDir, "image", fileName));
            fs.removeSync(path.join(dlImageOkDir, "image", "ok", fileName));

            fs.removeSync(path.join(dlVideoDir, fileName));
            fs.removeSync(path.join(dlVideoDir, "video", fileName));
            fs.removeSync(path.join(dlVideoDir, "video", "ok", fileName));
            fs.removeSync(path.join(dlVideoOkDir, fileName));
            fs.removeSync(path.join(dlVideoOkDir, "video", fileName));
            fs.removeSync(path.join(dlVideoOkDir, "video", "ok", fileName));
          }

          continue item_loop;
        }
      }

      // ダウンロード先の仕分け
      let dlDir;
      const imageExts = appConfig.fs.imageExts;
      if (imageExts.includes(fileExt)) {
        dlDir = dlImageDir;
      } else {
        dlDir = dlVideoDir;
      }

      const filePath = path.join(dlDir, fileName);

      // ファイルの存在と NG チェック
      const ngId = appConfig.ng.ngId;
      if (ngId.includes(postId) ||
          dlImageFiles.includes(fileName) ||
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
        childProcess.execFileSync('node', ['./lib/req-dl-fork.js', filePath, fileUrl, refererUrl]);
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

const concurrency = 1;

for (let i = 0; i < concurrency; i++) {
  exports.dlPosts();
}
