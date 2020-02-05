'use strict';

const fs = require('fs-extra');
const path = require('path');
const sanitize = require('sanitize-filename');
const log4js = require('log4js');
log4js.configure('./config/dl-log-config.json');
const req = require('./lib/req');
const ddb = require('./lib/ddb');
const sqs = require('./lib/sqs');
const walk = require('./lib/walk');
const appConfig = require('./config/app-config.json');

// ポストのダウンロード処理
exports.dlPosts = async () => {
  const logger = log4js.getLogger('system');

  // 認証リクエスト
  let authToken;
  try {
    authToken = await req.getToken();
  } catch(err) {
    console.log(err.message);
  }

  // ループ処理開始
  while (true) {
    // 優先キューからメッセージを取得
    const priorDlQueUrl = appConfig.mq.url.priorDlQueUrl;
    const recvParams = {
      QueueUrl: priorDlQueUrl,
    };

    let tagMsg;
    try {
      tagMsg = await sqs.recvMsg(recvParams);
    } catch(err) {
      console.log(err);
    }

    // 通常キューからメッセージを取得
    const dlQueUrl = appConfig.mq.url.dlQueUrl;
    if (tagMsg === undefined) {
      const recvParams = {
        QueueUrl: dlQueUrl,
      };

      try {
        tagMsg = await sqs.recvMsg(recvParams);
      } catch(err) {
        console.log(err);
      }
    }

    // メッセージが取得できない場合は待機
    const dlTable = appConfig.db.tab.dlTable;
    const dlQuePoll = appConfig.mq.poll.dlQuePoll;
    if (tagMsg === undefined) {
      console.log('Waiting for message...');
      const waitMsg = (dlQuePoll) => {
        return new Promise((resolve, reject) => {
          setTimeout(resolve, dlQuePoll * 1000);
        });
      };
      await waitMsg(dlQuePoll);
    } else {
      // DBの整合性チェック
      const tagAttr = appConfig.db.attr.tagAttr;
      const tagKey = tagMsg.tag;
      const checkParams = {
        TableName: dlTable,
        ExpressionAttributeNames:{'#d': tagAttr},
        ExpressionAttributeValues:{':val': tagKey},
        KeyConditionExpression: '#d = :val'
      };
      let itemCheck;
      try {
        itemCheck = await ddb.queryItem(checkParams);
      } catch(err) {
        console.log(JSON.stringify(err));
        continue;
      }

      if (itemCheck.Items.length === 0) {
        console.log('Skipped:' + tagKey);
        continue;
      }

      // 最終更新の取得
      let curLast = tagMsg.last;
      if (curLast === undefined) {
        curLast = 0;
      }

      let pageNum = 1;
      let newLast = 0;

      // ページ数でループ
      page_loop:
      while (true) {
        console.log(tagKey, pageNum);

        // 検索リクエスト
        let searchRes;
        try {
          searchRes = await req.searchPost(tagKey, pageNum, authToken);
        } catch(err) {
          switch (err.statusCode) {
            case 401:
              try {
                authToken = await req.getToken();
              } catch(err) {
                console.log(err.message);
              }
              break;
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

          // 最新Post番号の取得
          if (pageNum === 1) {
            newLast = searchRes[0].id;
          }

          // 検索結果でループ
          for (let i = 0; i < searchRes.length; i++) {
            const postId = searchRes[i].id;
            if (curLast > postId) {
              break page_loop;
            }

            // ファイル名の整形
            const fileUrl = searchRes[i].file_url;
            const extension = fileUrl.split('/').pop().split('?').shift()
                .split('.').pop();
            const fileName = postId + '.' + extension;
            const tagDir = path.join(appConfig.fs.dlDir, sanitize(tagKey));
            const histTagDir = path.join(appConfig.fs.histDir, sanitize(tagKey));
            const filePath = path.join(tagDir, fileName);

            // ファイルの存在チェック
            if (!await walk.walkExistsSync(tagDir, fileName) &&
                !await walk.walkExistsSync(histTagDir, fileName)) {

              // ディレクトリの作成
              fs.ensureDirSync(tagDir);

              // テンプレートファイルの配布
              const toolDir = appConfig.fs.toolDir;
              const orderFile = appConfig.fs.orderFile;
              const listFile = appConfig.fs.listFile;
              const orderFrom = path.join(toolDir, orderFile);
              const orderTo = path.join(tagDir, orderFile);
              const listFrom = path.join(toolDir, listFile);
              const listTo = path.join(tagDir, listFile);

              if (!fs.pathExistsSync(orderTo)) {
                fs.copySync(orderFrom, orderTo);
              }

              if (!fs.pathExistsSync(listTo)) {
                fs.copySync(listFrom, listTo);
              }

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

            // お気に入りリクエスト
            const isFaved = searchRes[i].is_favorited;
            if (!isFaved) {
              try {
                await req.favPost(postId, authToken);
              } catch(err) {
                switch (err.statusCode) {
                  case 401:
                    try {
                      authToken = await req.getToken();
                    } catch(err) {
                      console.log(err.message);
                    }
                    break;
                  default:
                    console.log(err.message);
                    continue page_loop;
                }
              }
            }
          }
        }

        pageNum++;
      }

      // 最新ポスト番号をDBに反映
      if (newLast > curLast) {
        const lastAttr = appConfig.db.attr.lastAttr;
        const updParams = {
          TableName: dlTable,
          Key: {
            'tag': tagKey
          },
          ExpressionAttributeNames: {
            '#l': lastAttr
          },
          ExpressionAttributeValues: {
            ':newLast': newLast
          },
          UpdateExpression: 'SET #l = :newLast'
        };

        try {
          await ddb.updateItem(updParams);
        } catch(err) {
          console.log(JSON.stringify(err));
        }
      }
    }
  }
}

const concurrency = 1;

for (let i = 0; i < concurrency; i++) {
  exports.dlPosts();
}
