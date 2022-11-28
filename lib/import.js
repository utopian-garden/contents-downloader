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
  let exOkDir;
  let exNgDir;
  switch (creatorType) {
    case artTab:
      log4js.configure('./config/imp-art-log-config.json');
      tabName = artTab;
      typeCode = appConfig.req.search.artistCode;
      exDir = appConfig.fs.artDir;
      exOkDir = appConfig.fs.artOkDir;
      exNgDir = appConfig.fs.artNgDir;
      break;

    case stuTab:
      log4js.configure('./config/imp-stu-log-config.json');
      tabName = stuTab;
      typeCode = appConfig.req.search.studioCode;
      exDir = appConfig.fs.stuDir;
      exOkDir = appConfig.fs.stuOkDir;
      exNgDir = appConfig.fs.stuNgDir;
      break;
  }

  // 初期化
  const logger = log4js.getLogger('system');

  // 既存 テーブルスキャン
  const extraItems = await ddb.scanAll(tabName);
  const extraTags = extraItems.map(item => { return item.tag });

  // Download/Ignore テーブルをスキャン
  const dlTab = appConfig.db.tab.dlTable;
  const dlItems = await ddb.scanAll(dlTab);
  const dlItemTags = dlItems.map(item => { return item.tag });

  const igTab = appConfig.db.tab.igTable;
  const igItems = await ddb.scanAll(igTab);
  const igItemTags = igItems.map(item => { return item.tag });

  const existTags = dlItemTags.concat(igItemTags);

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
        const searchItemCount = searchItem.count;

        // タグの Post 件数が 0 の場合
        if (searchItemCount === 0) {
          // Ignore に格納
          ddb.addItem(igTab, searchItemName);
          ddb.deleteItem(dlTab, searchItemName);
          ddb.deleteItem(artTab, searchItemName);
          ddb.deleteItem(stuTab, searchItemName);

          try {
            fs.removeSync(path.join(exDir, searchItemName));
            fs.removeSync(path.join(exOkDir, searchItemName));
            fs.removeSync(path.join(exNgDir, searchItemName));

            const dlImageDir = appConfig.fs.dlImageDir;
            const dlImageOkDir = appConfig.fs.dlImageOkDir;
            const dlImageNgDir = appConfig.fs.dlImageNgDir;
            fs.removeSync(path.join(dlImageDir, searchItemName));
            fs.removeSync(path.join(dlImageOkDir, searchItemName));
            fs.removeSync(path.join(dlImageNgDir, searchItemName));

            const dlVideoDir = appConfig.fs.dlVideoDir;
            const dlVideoOkDir = appConfig.fs.dlVideoOkDir;
            const dlVideoNgDir = appConfig.fs.dlVideoNgDir;
            fs.removeSync(path.join(dlVideoDir, searchItemName));
            fs.removeSync(path.join(dlVideoOkDir, searchItemName));
            fs.removeSync(path.join(dlVideoNgDir, searchItemName));
          } catch(err) {
            logger.error('removeSync', err.message);
          }

          continue;
        }

        // Artist/Studio テーブルと Download/Ignore テーブルに存在する場合
        if (extraTags.includes(searchItemName) &&
            existTags.includes(searchItemName)) {

          // Artist/Studio 側のフォルダを削除
          try {
            fs.removeSync(path.join(exDir, searchItemName));
            fs.removeSync(path.join(exOkDir, searchItemName));
            fs.removeSync(path.join(exNgDir, searchItemName));
          } catch(err) {
            logger.error('removeSync', err.message);
          }

          // Artist/Studio から削除するタグとして格納
          let tagObj = {
            DeleteRequest: {
              Key: { tag: searchItemName }
            }
          };
          batchRequest.push(tagObj);
        } else if (!extraTags.includes(searchItemName) &&
            !existTags.includes(searchItemName)) {

          // どちらにも存在しない場合は Artist/Studio に追加するタグとして格納
          let tagObj = {
            PutRequest: {
              Item: { tag: searchItemName }
            }
          };
          batchRequest.push(tagObj);
        };
      }

      // 格納されたバッチ処理を DB に対して実行
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
