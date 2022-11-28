'use strict';

// 依存パッケージ
const fs = require('fs-extra');
const log4js = require('log4js');
const path = require('path');
const sanitize = require('sanitize-filename');
require('console-stamp-color')(console, {
  format: ':date(yyyy/mm/dd HH:MM:ss.l) :label'
});

// ライブラリ
const ddb = require('./ddb');
const req = require('./req');
const sqs = require('./sqs');
const walk = require('./walk');

// 設定ファイル
const appConfig = require('../config/app-config.json');

// ポストのダウンロード処理
exports.extraDlPosts = async (dlType) => {
  const igTab = appConfig.db.tab.igTable;
  const artTab = appConfig.db.tab.artTable;
  const stuTab = appConfig.db.tab.stuTable;

  let quePoll;
  let queUrl;
  let priorQueUrl;
  let tabName;
  let typeDir;
  let typeOkDir;
  let typeNgDir;

  switch (dlType) {
    case igTab:
      log4js.configure('./config/dl-ig-log-config.json');
      tabName = appConfig.db.tab.igTable;
      queUrl = appConfig.mq.url.igQueUrl;
      priorQueUrl = appConfig.mq.url.priorIgQueUrl;
      quePoll = appConfig.mq.poll.igQuePoll;
      typeDir = appConfig.fs.igDir;
      typeOkDir = appConfig.fs.igOkDir;
      typeNgDir = appConfig.fs.igNgDir;
      break;

    case artTab:
      log4js.configure('./config/dl-art-log-config.json');
      tabName = appConfig.db.tab.artTable;
      queUrl = appConfig.mq.url.artQueUrl;
      quePoll = appConfig.mq.poll.artQuePoll;
      priorQueUrl = appConfig.mq.url.priorArtQueUrl;
      typeDir = appConfig.fs.artDir;
      typeOkDir = appConfig.fs.artOkDir;
      typeNgDir = appConfig.fs.artNgDir;
      break;

    case stuTab:
      log4js.configure('./config/dl-stu-log-config.json');
      tabName = appConfig.db.tab.stuTable;
      queUrl = appConfig.mq.url.stuQueUrl;
      quePoll = appConfig.mq.poll.stuQuePoll;
      priorQueUrl = appConfig.mq.url.priorStuQueUrl;
      typeDir = appConfig.fs.stuDir;
      typeOkDir = appConfig.fs.stuOkDir;
      typeNgDir = appConfig.fs.stuNgDir;
      break;
  }

  // 初期化
  const logger = log4js.getLogger('system');

  // 認証リクエスト
  const shortPoll = appConfig.req.poll.shortPoll;
  const longPoll = appConfig.req.poll.longPoll;
  let authToken;
  while (!authToken) {
    try {
      authToken = await req.getToken();
    } catch(err) {
      logger.error('getToken', err.message);
      await waitTimer(longPoll);
    }
  }

  // ループ処理開始
  let waitCount = 0;

  get_loop:
  while (true) {
    // 優先キューからメッセージを取得
    let tagMsg;
    try {
      tagMsg = await sqs.recvMsg(priorQueUrl);
    } catch(err) {
      logger.error('recvMsg', priorQueUrl, err);
      await waitTimer(quePoll);
    }

    // 通常キューからメッセージを取得
    if (!tagMsg) {
      try {
        tagMsg = await sqs.recvMsg(queUrl);
      } catch(err) {
        logger.error('recvMsg', queUrl, err);
        await waitTimer(quePoll);
      }
    }

    // メッセージを取得できない場合は後続をスキップしてメッセージ待ち
    if (!tagMsg) {
      waitCount++;

      if (waitCount === 1) {
        const waitingMsg = appConfig.mq.msg.waitingMsg;
        console.info(waitingMsg);
      }

      await waitTimer(quePoll);

      continue get_loop;
    }

    waitCount = 0;

    // 対象タグが DB に存在するかチェックし、存在しない場合はスキップ
    const tagAttr = appConfig.db.attr.tagAttr;
    const tagKey = tagMsg.tag;

    const ngTag = appConfig.ng.ngTag;
    if (ngTag.includes(tagKey)) {
      continue get_loop;
    }

    let tabItems;
    try {
      tabItems = await ddb.queryItem(tabName, tagAttr, tagKey);
    } catch(err) {
      logger.error('queryItem', JSON.stringify(err));
      continue get_loop;
    }

    if (tabItems.Items.length === 0) {
      continue get_loop;
    }

    // 既存ファイル名取得
    const exDir = path.join(typeDir, sanitize(tagKey));
    const exOkDir = path.join(typeOkDir, sanitize(tagKey));
    const exNgDir = path.join(typeNgDir, sanitize(tagKey));
    const exFiles = await walk.walkFileSync(exDir);
    const exOkFiles = await walk.walkFileSync(exOkDir);
    const exNgFiles = await walk.walkFileSync(exNgDir);

    // ページ数でループ
    let pageNum = 1;

    page_loop:
    while (2 > pageNum) {
      console.info(tagKey, pageNum);

      // 検索リクエスト
      const searchParam = appConfig.req.search.exSearchParam;
      let searchRes;
      try {
        searchRes = await req.searchPost(
            tagKey, pageNum, searchParam, authToken);
        await waitTimer(shortPoll);
      } catch(err) {
        if (!err.response) {
          logger.error('searchPost', tagKey, pageNum, err.message);
          continue page_loop;
        }

        switch (err.response.status) {
          case 401:
            console.error('searchPost',
                tagKey, pageNum, err.response.status);
            try {
              authToken = await req.getToken();
            } catch(err) {
              logger.error('getToken', err.message);
            }
            continue page_loop;

          case 429:
          case 502:
          case 503:
            console.error('searchPost',
                tagKey, pageNum, err.response.status);
            await waitTimer(longPoll);
            continue page_loop;

          default:
            logger.error('searchPost',
                tagKey, pageNum, err.response.status);
            continue page_loop;
        }
      }

      // 続行条件のチェック
      if (searchRes) {
        if (searchRes.length === 0) {
          break;
        }

        // 検索結果でループ
        item_loop:
        for (let item of searchRes) {
          const postId = item.id;

          // ファイル名の整形
          const fileUrl = item.file_url;
          const fileExt = (fileUrl.match(/.*\.(.*)\?.*/))[1];
          const fileName = postId + '.' + fileExt;
          const filePath = path.join(exDir, fileName);

          // NG ワードチェック
          for (let tag of item.tags) {
            const ngText = appConfig.ng.ngText;
            if (ngText.includes(tag.name_en)) {
              if (exFiles.includes(fileName) ||
                  exOkFiles.includes(fileName) ||
                  exNgFiles.includes(fileName)) {

                fs.removeSync(path.join(exDir, fileName));
                fs.removeSync(path.join(exOkDir, fileName));
                fs.removeSync(path.join(exNgDir, fileName));
              }

              continue item_loop;
            }
          }

          // 拡張子チェック
          const ignoreExts = appConfig.fs.ignoreExts;
          if (ignoreExts.includes(fileExt)) {
            continue item_loop;
          }

          // ファイルの存在と NG チェック
          const ngId = appConfig.ng.ngId;
          if (ngId.includes(postId) ||
              exFiles.includes(fileName) ||
              exOkFiles.includes(fileName) ||
              exNgFiles.includes(fileName)) {

            continue item_loop;
          }

          // ディレクトリの作成
          fs.ensureDirSync(exDir);

          // ダウンロード リクエスト
          const refererUrl = appConfig.req.dl.refererUrl + postId;
          try {
            await req.dlContent(filePath, fileUrl, refererUrl);
          } catch(err) {
            if (!err.response) {
              logger.error('dlContent', postId, err.message);
              continue page_loop;
            }

            switch (err.response.status) {
              case 404:
                console.error('dlContent', postId, err.response.status);
                continue;

              default:
                logger.error('dlContent', postId, err.response.status);
                continue page_loop;
            }
          }
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

// メイン処理の起動
const dlType = process.argv[2];

if (dlType) {
  exports.extraDlPosts(dlType);
} else {
  console.info('Usage: node ' + path.basename(process.argv[1]) +
      ' <Download Type (Ignore/Artist/Studio)>');
}
