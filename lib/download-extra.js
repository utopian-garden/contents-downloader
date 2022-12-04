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
  const igTable = appConfig.db.tab.igTable;
  const artTable = appConfig.db.tab.artTable;
  const stuTable = appConfig.db.tab.stuTable;

  let quePoll;
  let queUrl;
  let priorQueUrl;
  let tabName;
  let typeDir;
  let typeOkDir;
  let typeNgDir;

  switch (dlType) {
    case igTable:
      log4js.configure('./config/dl-ig-log-config.json');
      tabName = igTable;
      queUrl = appConfig.mq.url.igQueUrl;
      priorQueUrl = appConfig.mq.url.priorIgQueUrl;
      quePoll = appConfig.mq.poll.igQuePoll;
      typeDir = appConfig.fs.igDir;
      typeOkDir = appConfig.fs.igOkDir;
      typeNgDir = appConfig.fs.igNgDir;
      break;

    case artTable:
      log4js.configure('./config/dl-art-log-config.json');
      tabName = artTable;
      queUrl = appConfig.mq.url.artQueUrl;
      quePoll = appConfig.mq.poll.artQuePoll;
      priorQueUrl = appConfig.mq.url.priorArtQueUrl;
      typeDir = appConfig.fs.artDir;
      typeOkDir = appConfig.fs.artOkDir;
      typeNgDir = appConfig.fs.artNgDir;
      break;

    case stuTable:
      log4js.configure('./config/dl-stu-log-config.json');
      tabName = stuTable;
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
    const tagKey = tagMsg.tag;

    const ngTag = appConfig.ng.ngTag;
    if (ngTag.includes(tagKey)) {
      continue get_loop;
    }

    let tabItems;
    try {
      tabItems = await ddb.getItem(tabName, tagKey);
    } catch(err) {
      logger.error('getItem', JSON.stringify(err));
      continue get_loop;
    }

    if (!tabItems.Item) {
      continue get_loop;
    }

    // Tag テーブルのタグの postid を削除
    const tagTable = appConfig.db.tab.tagTable;
    const postAttr = appConfig.db.attr.postAttr;
    await ddb.deleteItem(tagTable, tagKey);
    await ddb.updateItem(tagTable, tagKey, postAttr, []);

    // ページ数でループ
    let pageNum = 1;

    const dlItems = [];
    const postArray = [];

    page_loop:
    while (dlItems.length < 10) {
      console.info(tagKey, pageNum);

      // 検索リクエスト
      const searchParam = appConfig.req.search.exSearchParam;
      let searchRes;

      try {
        searchRes = await req.searchPost(
            tagKey, pageNum, searchParam, authToken);

        const shortPoll = appConfig.req.poll.shortPoll;
        await waitTimer(shortPoll);
      } catch(err) {
        if (!err.response) {
          logger.error('searchPost', tagKey, pageNum, err.message);
          continue page_loop;
        }

        logger.error('searchPost', tagKey, pageNum, err.response.status);

        switch (err.response.status) {
          case 401:
            try {
              authToken = await req.getToken();
            } catch(err) {
              logger.error('getToken', err.message);
            }
            continue page_loop;

          case 429:
            await waitTimer(longPoll);
            continue page_loop;

          case 502:
          case 503:
            const middlePoll = appConfig.req.poll.middlePoll;
            await waitTimer(middlePoll);
            continue page_loop;

          default:
            continue page_loop;
        }
      }

      if (searchRes && searchRes.length === 0) {
        break page_loop;
      }

      // 検索結果でループ
      check_loop:
      for (let post of searchRes) {
        // Post ID と拡張子の NG チェック
        const ngId = appConfig.ng.ngId;
        const ignoreExts = appConfig.fs.ignoreExts;
        const fileUrl = post.file_url;
        const fileExt = (fileUrl.match(/.*\.(.*)\?.*/))[1];
        if (ngId.includes(post.id) || ignoreExts.includes(fileExt)) {
          continue check_loop;
        }

        // タグの NG チェック
        for (let tag of post.tags) {
          const ngText = appConfig.ng.ngText;
          if (ngText.includes(tag.name_en)) {
            continue check_loop;
          }
        }

        // 件数が 10 件になるまでレコードを配列に Push
        if (dlItems.length < 10) {
          dlItems.push(post);
          postArray.push(post.id);
        }
      }

      pageNum++;
    }

    // Tag テーブルに postid の配列を追加する
    await ddb.addArrayItem(tagTable, tagKey, postAttr, postArray);

    // 既存ファイル名取得
    const exDir = path.join(typeDir, sanitize(tagKey));
    const exOkDir = path.join(typeOkDir, sanitize(tagKey));
    const exNgDir = path.join(typeNgDir, sanitize(tagKey));
    const exFiles = await walk.walkFileSync(exDir);
    const exOkFiles = await walk.walkFileSync(exOkDir);
    const exNgFiles = await walk.walkFileSync(exNgDir);

    // 続行条件のチェック
    if (dlItems && dlItems.length !== 0) {
      // 検索結果でループ
      item_loop:
      for (let post of dlItems) {
        const postId = post.id;

        // ファイル名の整形
        const fileUrl = post.file_url;
        const fileExt = (fileUrl.match(/.*\.(.*)\?.*/))[1];
        const fileName = postId + '.' + fileExt;
        const filePath = path.join(exDir, fileName);

        // ファイルの存在チェック
        if (exFiles.includes(fileName) ||
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
            continue item_loop;
          }

          switch (err.response.status) {
            case 404:
              logger.error('dlContent', postId, err.response.status);
              continue;

            default:
              logger.error('dlContent', postId, err.response.status);

              waitTimer(longPoll);

              continue item_loop;
          }
        }
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

// メイン処理の起動
const dlType = process.argv[2];

if (dlType) {
  exports.extraDlPosts(dlType);
} else {
  console.info('Usage: node ' + path.basename(process.argv[1]) +
      ' <Download Type (Ignore/Artist/Studio)>');
}
