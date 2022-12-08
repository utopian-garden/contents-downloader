'use strict';

// 依存パッケージ
const fs = require('fs-extra');
const path = require('path');
const sanitize = require('sanitize-filename');
require('console-stamp-color')(console, {
  format: ':date(yyyy/mm/dd HH:MM:ss.l) :label'
});

// ライブラリ
const req = require('./req');
const ddb = require('./ddb');
const log4js = require('log4js');

// 設定ファイル
const appConfig = require('../config/app-config.json');

// 定義
const dir = appConfig.fs.dir;
const reqPoll = appConfig.req.poll;
const search = appConfig.req.search;
const tab = appConfig.db.tab;

// タグの DB レコードインポート
exports.importCreator = async(creatorType) => {
  let tabName;
  let typeCode;
  let exDir;
  let exOkDir;
  let exNgDir;
  switch (creatorType) {
    case tab.artTable:
      log4js.configure('./config/imp-art-log-config.json');
      tabName = tab.artTable;
      typeCode = search.artistCode;
      exDir = dir.artDir;
      exOkDir = dir.artOkDir;
      exNgDir = dir.artNgDir;
      break;

    case tab.stuTable:
      log4js.configure('./config/imp-stu-log-config.json');
      tabName = tab.stuTable;
      typeCode = search.studioCode;
      exDir = dir.stuDir;
      exOkDir = dir.stuOkDir;
      exNgDir = dir.stuNgDir;
      break;
  }

  // 初期化
  const logger = log4js.getLogger('system');

  // 既存 テーブルスキャン
  const extraItems = await ddb.scanAll(tabName);
  const extraTags = extraItems.map(item => { return item.tag });

  // Download/Ignore テーブルをスキャン
  const dlTable = tab.dlTable;
  const dlItems = await ddb.scanAll(dlTable);
  const dlItemTags = dlItems.map(item => { return item.tag });

  const igTable = tab.igTable;
  const igItems = await ddb.scanAll(igTable);
  const igItemTags = igItems.map(item => { return item.tag });

  const existTags = dlItemTags.concat(igItemTags);

  // 認証リクエスト
  const shortPoll = reqPoll.shortPoll;
  const middlePoll = reqPoll.middlePoll;
  const longPoll = reqPoll.longPoll;
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
        await waitTimer(shortPoll);
        continue page_loop;
      }

      logger.error('searchTag', tabName, pageNum, err.response.status);

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
          await waitTimer(middlePoll);
          continue page_loop;

        default:
          await waitTimer(shortPoll);
          continue page_loop;
      }
    }

    // 続行条件のチェック
    if (searchRes) {
      if (searchRes.length === 0) {
        break;
      }

      // 検索結果でループ
      const batchRequest = [];
      for (let searchItem of searchRes) {
        const tagName = searchItem.name;
        const saniTagName = sanitize(tagName);
        const tagCount = searchItem.count;

        // タグの Post 件数が 0 の場合
        if (tagCount === 0) {
          // Ignore に格納
          ddb.addItem(igTable, tagName);
          ddb.deleteItem(dlTable, tagName);
          ddb.deleteItem(tab.artTable, tagName);
          ddb.deleteItem(tab.stuTable, tagName);

          if (saniTagName) {
            try {
              fs.removeSync(path.join(exDir, saniTagName));
              fs.removeSync(path.join(exOkDir, saniTagName));
              fs.removeSync(path.join(exNgDir, saniTagName));

              fs.removeSync(path.join(dir.dlImageDir, saniTagName));
              fs.removeSync(path.join(dir.dlImageOkDir, saniTagName));
              fs.removeSync(path.join(dir.dlImageNgDir, saniTagName));

              fs.removeSync(path.join(dir.dlVideoDir, saniTagName));
              fs.removeSync(path.join(dir.dlVideoOkDir, saniTagName));
              fs.removeSync(path.join(dir.dlVideoNgDir, saniTagName));
            } catch(err) {
              logger.error('removeSync', err.message);
            }
          }

          continue;
        }

        // Artist/Studio テーブルと Download/Ignore テーブルに存在する場合
        if (extraTags.includes(tagName) &&
            existTags.includes(tagName)) {

          // Artist/Studio 側のフォルダを削除
          if (saniTagName) {
            try {
              fs.removeSync(path.join(exDir, saniTagName));
              fs.removeSync(path.join(exOkDir, saniTagName));
              fs.removeSync(path.join(exNgDir, saniTagName));
            } catch(err) {
              logger.error('removeSync', err.message);
            }
          }

          // Artist/Studio から削除するタグとして格納
          const tagObj = {
            DeleteRequest: {
              Key: { tag: tagName }
            }
          };
          batchRequest.push(tagObj);
        } else if (!extraTags.includes(tagName) &&
            !existTags.includes(tagName)) {

          // どちらにも存在しない場合は Artist/Studio に追加するタグとして格納
          const tagObj = {
            PutRequest: {
              Item: { tag: tagName }
            }
          };
          batchRequest.push(tagObj);
        };
      }

      // 格納されたバッチ処理を DB に対して実行
      for (let i = 0; i < batchRequest.length; i = i + 25) {
        try {
          const reqSlice = batchRequest.slice(i, i + 24);
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
