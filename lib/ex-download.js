'use strict';

// 依存パッケージ
const fs = require('fs-extra');
const log4js = require('log4js');
const path = require('path');
const sanitize = require('sanitize-filename');

// ライブラリ
const ddb = require('./ddb');
const req = require('./req');
const sqs = require('./sqs');
const walk = require('./walk');

// 設定ファイル
const appConfig = require('../config/app-config.json');
log4js.configure('./config/ex-log-config.json');

// ポストのダウンロード処理
exports.extraDlPosts = async (dlType) => {
  const logger = log4js.getLogger('system');
  const igTab = appConfig.db.tab.igTable;
  const artTab = appConfig.db.tab.artTable;
  const stuTab = appConfig.db.tab.stuTable;

  let quePoll;
  let queUrl;
  let tabName;
  let typeDir;
  let typeHistDir;
  let tagMsg;
  switch (dlType) {
    case igTab:
      tabName = appConfig.db.tab.favTable;
      queUrl = appConfig.mq.url.igQueUrl;
      quePoll = appConfig.mq.poll.igQuePoll;
      typeDir = appConfig.fs.igDir;
      typeHistDir = appConfig.fs.igHistDir;
      break;
    case artTab:
      tabName = appConfig.db.tab.artTable;
      queUrl = appConfig.mq.url.artQueUrl;
      quePoll = appConfig.mq.poll.artQuePoll;
      typeDir = appConfig.fs.artDir;
      typeHistDir = appConfig.fs.artHistDir;
      break;
    case stuTab:
      tabName = appConfig.db.tab.stuTable;
      queUrl = appConfig.mq.url.stuQueUrl;
      quePoll = appConfig.mq.poll.stuQuePoll;
      typeDir = appConfig.fs.stuDir;
      typeHistDir = appConfig.fs.stuHistDir;
      break;
  }

  // 認証リクエスト
  let authToken;
  try {
    authToken = await req.getToken();
  } catch(err) {
    console.log(err.message);
  }

  // ループ処理開始
  while (true) {
    // 通常キューからメッセージを取得
    const recvParams = {
      QueueUrl: queUrl,
    };

    try {
      tagMsg = await sqs.recvMsg(recvParams);
    } catch(err) {
      console.log(err);
    }

    // メッセージが取得できない場合は待機
    if (tagMsg === undefined) {
      console.log('Waiting for message...');
      const waitMsg = (quePoll) => {
        return new Promise((resolve, reject) => {
          setTimeout(resolve, quePoll * 1000);
        });
      };
      await waitMsg(quePoll);
    } else {
      // DB の整合性チェック
      const tagAttr = appConfig.db.attr.tagAttr;
      const tagKey = tagMsg.tag;
      const checkParams = {
        TableName: tabName,
        ExpressionAttributeNames:{'#t': tagAttr},
        ExpressionAttributeValues:{':val': tagKey},
        KeyConditionExpression: '#t = :val'
      };
      let itemCheck;
      try {
        itemCheck = await ddb.queryItem(checkParams);
      } catch(err) {
        console.log(JSON.stringify(err));
        continue;
      }

      if (itemCheck.Items.length === 0) {
        console.log('Skipped: ' + tagKey);
        continue;
      }

      let pageNum = 1;
      const searchParam = appConfig.req.search.exSearchParam;

      // ページ数でループ
      page_loop:
      while (2 > pageNum) {
        console.log(tagKey, pageNum);

        // 検索リクエスト
        let searchRes;
        try {
          searchRes = await req.searchPost(encodeURIComponent(tagKey), pageNum,
              searchParam, authToken);
        } catch(err) {
          switch (err.statusCode) {
            case 401:
              try {
                authToken = await req.getToken();
              } catch(err) {
                console.log(err.message);
              }
              continue;

            case 400:
              console.log(err.message);
              break page_loop;

            case 408:
              logger.debug(tagKey, err.message);
              break page_loop;

            default:
              console.log(err.message);
              continue page_loop;
          }

        }

        // 続行条件のチェック
        if (searchRes !== undefined) {
          if (searchRes.length === 0) {
            if (pageNum === 1) {
              logger.debug(tagKey);
            }

            break;
          }

          // 検索結果でループ
          for (let item of searchRes) {
            const postId = item.id;

            // ファイル名の整形
            const fileUrl = item.file_url;
            const extension = fileUrl.split('/').pop().split('?').shift()
                .split('.').pop();
            const fileName = postId + '.' + extension;
            const exDir = path.join(typeDir, sanitize(tagKey));
            const exHistDir = path.join(typeHistDir, sanitize(tagKey));
            const filePath = path.join(exDir, fileName);

            // ファイルの存在と NG チェック
            const ngId = appConfig.ng.ngId;
            if (postId === ngId ||
                await walk.walkExistsSync(exDir, fileName) ||
                await walk.walkExistsSync(exHistDir, fileName)) {

              continue;
            }

            // ディレクトリの作成
            fs.ensureDirSync(exDir);

            // ダウンロード リクエスト
            const refererUrl = appConfig.req.dl.refererUrl + postId;
            try {
              await req.dlContent(filePath, fileUrl, refererUrl);
              console.log(postId);
            } catch(err) {
              switch(err.statusCode) {
                case 404:
                  break;
                default:
                  console.log(err.message);
                  continue page_loop;
              }
            }
          }
        }

        pageNum++;
      }
    }
  }
}

// メイン処理の起動
const concurrency = 1;
const dlType = process.argv[2];

if (dlType !== undefined && dlType) {
  for (let i = 0; i < concurrency; i++) {
    exports.extraDlPosts(dlType);
  }
} else {
  console.log('Usage: node ' + path.basename(process.argv[1]) + ' <Download Type (Ignore/Artist/Studio)>');
}