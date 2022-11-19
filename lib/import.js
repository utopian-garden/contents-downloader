'use strict';

// 依存パッケージ
const fs = require('fs-extra');
const path = require('path');
require('console-stamp-color')(console, {
  format: ':date(yyyy/mm/dd HH:MM:ss.l) :label'
});

// ライブラリ
const req = require('./req');
const ddb = require('./ddb');
const log4js = require('log4js');

// 設定ファイル
const appConfig = require('../config/app-config.json');

// タグの DB レコードインポート
exports.importCreator = async(creatorType) => {
  const artTab = appConfig.db.tab.artTable;
  const stuTab = appConfig.db.tab.stuTable;
  let tabName;
  let typeCode;
  let exDir;
  switch (creatorType) {
    case artTab:
      log4js.configure('./config/imp-art-log-config.json');
      tabName = appConfig.db.tab.artTable;
      typeCode = appConfig.req.search.artistCode;
      exDir = appConfig.fs.artDir;
      break;
    case stuTab:
      log4js.configure('./config/imp-stu-log-config.json');
      tabName = appConfig.db.tab.stuTable;
      typeCode = appConfig.req.search.studioCode;
      exDir = appConfig.fs.stuDir;
      break;
  }

  // 初期化
  const logger = log4js.getLogger('system');

  // 既存 テーブルスキャン
  let extraTags = [];
  let extraItems = [];
  try {
    extraItems = await ddb.scanAll(tabName);
  } catch(err) {
    logger.error('scanAll', err);
    throw err;
  }

  for (let extraItem of extraItems) {
    extraTags.push(extraItem.tag);
  }

  // Download/Ignore テーブルをスキャン
  const dlTab = appConfig.db.tab.dlTable;
  const igTable = appConfig.db.tab.igTable;
  let existTags = [];
  let scanTabs = [dlTab, igTable];
  for (let scanTab of scanTabs) {
    let existItems = [];
    try {
      existItems = await ddb.scanAll(scanTab);
    } catch(err) {
      logger.error('scanAll', err);
      throw err;
    }

    for (let existItem of existItems) {
      existTags.push(existItem.tag);
    }
  }

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

  // ページ数でループ
  let pageNum = 1;

  page_loop:
  while (true) {
    console.info(tabName, pageNum);

    // 検索リクエスト
    let searchRes;
    try {
      searchRes = await req.searchTag(typeCode, pageNum, authToken);
      await waitTimer(shortPoll);
    } catch(err) {
      if (!err.response) {
        logger.error('searchTag', tabName, pageNum, err.message);
        continue page_loop;
      }

      switch (err.response.status) {
        case 401:
          console.error('searchTag', tabName, pageNum, err.response.status);
          try {
            authToken = await req.getToken();
          } catch(err) {
            logger.error('getToken', err.message);
          }
          continue page_loop;

        case 429:
        case 502:
        case 503:
          console.error('searchTag', tabName, pageNum, err.response.status);
          await waitTimer(longPoll);
          continue page_loop;

        default:
          logger.error('searchTag', tabName, pageNum, err.response.status);
          continue page_loop;
      }
    }

    // 続行条件のチェック
    if (searchRes) {
      if (searchRes.length === 0) {
        break;
      }

      // 検索結果でループ
      let batchRequest = [];
      for (let searchItem of searchRes) {
        const searchItemName = searchItem.name;
        if (extraTags.includes(searchItemName) &&
            existTags.includes(searchItemName)) {

          // Artist/Studio テーブルと Download/Ignore テーブルに存在する場合
          // フォルダを削除しテーブルから削除するタグとして push
          const exTagDir = path.join(exDir, searchItemName);
          try {
            fs.removeSync(exTagDir);
          } catch(err) {
            logger.error('removeSync', err.message);
          }
          let tagObj = {
            DeleteRequest: {
              Key: { tag: searchItemName }
            }
          };
          batchRequest.push(tagObj);
        }

        if (!extraTags.includes(searchItemName) &&
            !existTags.includes(searchItemName)) {

          // どちらにも存在しない場合はテーブルにインポートするタグとして push
          let tagObj = {
            PutRequest: {
              Item: { tag: searchItemName }
            }
          };
          batchRequest.push(tagObj);
        };
      }

      for (let i = 0; i < batchRequest.length; i = i + 25) {
        try {
          let reqSlice = batchRequest.slice(i, i + 24);
          if (reqSlice.length > 0) {
            await ddb.writeItems(tabName, reqSlice);
          }
        } catch(err) {
          logger.error('ddbWrite', err.message);
        }
      }
    }

    pageNum++;
  }
}

// Wait 処理
const waitTimer = (quePoll) => {
  return new Promise((resolve, reject) => {
    setTimeout(resolve, quePoll * 1000);
  });
};

// メイン処理の起動
const creatorType = process.argv[2];

if (creatorType) {
  exports.importCreator(creatorType);
} else {
  console.info('Usage: node ' + path.basename(process.argv[1]) +
      ' <creatorType(Artist/Studio)>');
}
