'use strict';

// 依存パッケージ
const fs = require('fs-extra');
const log4js = require('log4js');
const path = require('path');
const sanitize = require('sanitize-filename');
require('console-stamp')(console, { pattern: 'yyyy/mm/dd HH:MM:ss' });

// ライブラリ
const ddb = require('./ddb');
const req = require('./req');
const sqs = require('./sqs');
const walk = require('./walk');

// 設定ファイル
const appConfig = require('../config/app-config.json');

// ポストのダウンロード処理
exports.dlPosts = async () => {
  // 初期化
  log4js.configure('./config/download-log-config.json');
  const logger = log4js.getLogger('system');

  // 認証リクエスト
  const reqPoll = appConfig.req.poll.reqPoll;
  let authToken;
  while (!authToken) {
    try {
      authToken = await req.getToken();
    } catch(err) {
      logger.error('getToken', err.message);
      await waitTimer(reqPoll);
    }
  }

  // ループ処理開始
  while (true) {
    // 優先キューからメッセージを取得
    const priorDlQueUrl = appConfig.mq.url.priorDlQueUrl;
    const dlQuePoll = appConfig.mq.poll.dlQuePoll;
    let tagMsg;
    try {
      tagMsg = await sqs.recvMsg(priorDlQueUrl);
    } catch(err) {
      logger.error('recvMsg', err);
      await waitTimer(dlQuePoll);
    }

    // 通常キューからメッセージを取得
    const dlQueUrl = appConfig.mq.url.dlQueUrl;
    if (tagMsg === undefined) {
      try {
        tagMsg = await sqs.recvMsg(dlQueUrl);
      } catch(err) {
        logger.error('recvMsg', err);
        await waitTimer(dlQuePoll);
      }
    }

    // メッセージが取得できない場合は待機
    if (tagMsg === undefined) {
      const waitingMsg = appConfig.mq.msg.waitingMsg;
      console.info(waitingMsg);
      await waitTimer(dlQuePoll);
    } else {
      // DB の整合性チェック
      const dlTable = appConfig.db.tab.dlTable;
      const tagAttr = appConfig.db.attr.tagAttr;
      const tagKey = tagMsg.tag;
      let tabItems;
      try {
        tabItems = await ddb.queryItem(dlTable, tagAttr, tagKey);
      } catch(err) {
        logger.error('queryItem', JSON.stringify(err));
        continue;
      }

      if (tabItems.Items.length === 0) {
        continue;
      }

      // 既存ファイル名の取得
      const dlImageDir = path.join(appConfig.fs.dlImageDir, sanitize(tagKey));
      const dlImageOkDir = path.join(appConfig.fs.dlImageOkDir, sanitize(tagKey));
      const dlImageFiles = await walk.walkFileSync(dlImageDir);
      const dlImageOkFiles = await walk.walkFileSync(dlImageOkDir);

      const dlVideoDir = path.join(appConfig.fs.dlVideoDir, sanitize(tagKey));
      const dlVideoOkDir = path.join(appConfig.fs.dlVideoOkDir, sanitize(tagKey));
      const dlVideoFiles = await walk.walkFileSync(dlVideoDir);
      const dlVideoOkFiles = await walk.walkFileSync(dlVideoOkDir);

      // 最終更新の取得
      let curLast = tagMsg.last;
      if (curLast === undefined) {
        curLast = 0;
      }

      // ページ数でループ
      let pageNum = 1;
      let newLast = 0;

      page_loop:
      while (true) {
        console.info(tagKey, pageNum);

        // 検索リクエスト
        const searchParam = appConfig.req.search.searchParam;
        let searchRes;
        try {
          searchRes = await req.searchPost(encodeURIComponent(tagKey), pageNum,
              searchParam, authToken);
          //logger.debug('searchPost', tagKey, pageNum);
        } catch(err) {
          if (err.response) {
            switch (err.response.status) {
              case 401:
                console.error('searchPost', tagKey, pageNum, err.response.status);
                try {
                  authToken = await req.getToken();
                } catch(err) {
                  logger.error('getToken', err.message);
                }
                continue page_loop;

              case 400:
              case 408:
              case 504:
                logger.error('searchPost', tagKey, pageNum, err.response.status);
                break page_loop;

              case 502:
              case 503:
                console.error('searchPost', tagKey, pageNum, err.response.status);
                await waitTimer(reqPoll);
                continue page_loop;

              default:
                logger.error('searchPost', tagKey, pageNum, err.response.status);
                continue page_loop;
            }
          } else {
            logger.error('searchPost', tagKey, pageNum, err.message);
            continue page_loop;
          }
        }

        // 続行条件のチェック
        if (searchRes) {
          if (searchRes.length === 0) {
            if (pageNum === 1) {
              try {
                ddb.deleteItem(dlTable, tagKey);
                //logger.debug('deleteItem', tagKey);
              } catch(err) {
                logger.error('deleteItem', err.message);
              }
            }

            break;
          }

          // 最新 Post 番号の取得
          if (pageNum === 1) {
            newLast = searchRes[0].id;
          }

          // 検索結果でループ
          for (let item of searchRes) {
            const postId = item.id;
            if (curLast > postId) {
              break page_loop;
            }

            // ファイル名の整形
            const fileUrl = item.file_url;
            const fileExt = (fileUrl.match(/.*\.(.*)\?.*/))[1];
            const fileName = postId + '.' + fileExt;

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
              newLast = postId;
              continue;
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
              await req.dlContent(filePath, fileUrl, refererUrl);
              //logger.debug('dlContent', filePath, fileUrl, refererUrl);
              if (newLast === 0) {
                newLast = postId;
              }
            } catch(err) {
              newLast = 0;
              if (err.response) {
                switch (err.response.status) {
                  case 404:
                    continue;
                  default:
                    logger.error('dlContent', tagKey, postId, err.response.status);
                    continue;
                }
              } else {
                logger.error('dlContent', tagKey, postId, err.message);
                continue;
              }
            }

            /* お気に入りリクエスト
            const isFaved = item.is_favorited;
            if (!isFaved) {
              try {
                await req.favPost(postId, authToken);
              } catch(err) {
                if (err.response) {
                  switch (err.response.status) {
                    case 401:
                      console.error('favPost', postId, err.response.status);
                      try {
                        authToken = await req.getToken();
                      } catch(err) {
                        logger.error('getToken', err.message);
                      }
                      continue page_loop;
                    default:
                      logger.error('favPost', postId, err.response.status);
                      continue page_loop;
                  }
                } else {
                  logger.error('favPost', postId, err.message);
                  continue page_loop;
                }
              }
            } */
          }
        }

        pageNum++;
      }

      // 最新ポスト番号を DB に反映
      if (newLast > curLast) {
        const lastAttr = appConfig.db.attr.lastAttr;
        try {
          await ddb.updateItem(dlTable, lastAttr, tagKey, newLast);
          //logger.debug('updateItem', dlTable, lastAttr, tagKey, newLast);
        } catch(err) {
          logger.error('updateItem', JSON.stringify(err));
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

const concurrency = 1;

for (let i = 0; i < concurrency; i++) {
  exports.dlPosts();
}
