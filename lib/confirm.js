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

// 設定ファイル
const appConfig = require('../config/app-config.json');

// DB のディレクトリの修正処理
exports.dbConfirm = async (confirmType) => {
  const dlTab = appConfig.db.tab.dlTable;
  const igTab = appConfig.db.tab.igTable;
  let tabName;
  let conDirs = [];
  let conOkNgDirs = [];

  switch (confirmType) {
    case dlTab:
      log4js.configure('./config/con-dl-log-config.json');
      tabName  = appConfig.db.tab.dlTable;
      conDirs.push(appConfig.fs.dlImageDir);
      conDirs.push(appConfig.fs.dlVideoDir);
      conOkNgDirs.push(appConfig.fs.dlImageOkDir);
      conOkNgDirs.push(appConfig.fs.dlVideoOkDir);
      break;
    case igTab:
      log4js.configure('./config/con-ig-log-config.json');
      tabName = appConfig.db.tab.igTable;
      conDirs.push(appConfig.fs.igDir);
      conOkNgDirs.push(appConfig.fs.igNgDir);
      break;
  }

  // 初期化
  const logger = log4js.getLogger('system');

  // 認証リクエスト
  const longPoll = appConfig.req.poll.longPoll;
  const shortPoll = appConfig.req.poll.shortPoll;
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
  let tabItems = await ddb.scanAll(tabName);
  for (let tabItem of tabItems) {
    const tagKey = tabItem.tag;

    // ページ数でループ
    let pageNum = 1;

    page_loop:
    while (2 > pageNum) {
      console.info(tagKey, pageNum);

      // 検索リクエスト
      const conSearchParam = appConfig.req.search.conSearchParam;
      let searchRes;
      try {
        searchRes = await req.searchPost(
            tagKey, pageNum, conSearchParam, authToken);
        await waitTimer(shortPoll);
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

            case 429:
            case 502:
            case 503:
              console.error('searchPost', tagKey, pageNum, err.response.status);
              await waitTimer(longPoll);
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
          const searchUrl = appConfig.req.search.searchUrl;
          logger.debug('nothing', tagKey, searchUrl +
              encodeURIComponent(tagKey) + conSearchParam + pageNum);
          break;
        }

        // 検索結果でループ
        for (let item of searchRes) {
          for (let tag of item.tags) {
            // 日本語タグの英語化
            if (!tagKey.match(/^[\x20-\x7e]*$/) && tag.name_ja === tagKey &&
                tag.name_en !== tagKey && tag.name_en !== null) {

              // DB に追加
              const lastAttr = appConfig.db.attr.lastAttr;
              try {
                await ddb.updateItem(tabName, lastAttr, tag.name_en, 0);
              } catch(err) {
                logger.error('updateItem', JSON.stringify(err));
              }

              // フォルダのリネーム
              for (let conDir of conDirs) {
                const enDir = path.join(conDir, sanitize(tag.name_en));
                const jaDir = path.join(conDir, sanitize(tag.name_ja));
                if (fs.pathExistsSync(jaDir)) {
                  fs.moveSync(jaDir, enDir, { overwrite: true });
                }
              }

              for (let conOkNgDir of conOkNgDirs) {
                const enOkNgDir = path.join(conOkNgDir, sanitize(tag.name_en));
                const jaOkNgDir = path.join(conOkNgDir, sanitize(tag.name_ja));
                if (fs.pathExistsSync(jaOkNgDir)) {
                  fs.moveSync(jaOkNgDir, enOkNgDir, { overwrite: true });
                }
              }

              // DB から削除
              try {
                await ddb.deleteItem(tabName, tag.name_ja);
                logger.debug('dbConfirm', tag.name_ja, tag.name_en);
              } catch(err) {
                logger.error('deleteItem', JSON.stringify(err));
              }
            }

            // artist でも studio でもないタグの削除
            if ((tag.name_en === tagKey || tag.name_ja === tagKey) &&
                tag.type !== 1 && tag.type !== 2) {

              // フォルダの削除
              for (let conDir of conDirs) {
                if (tag.name_en) {
                  const enDir = path.join(conDir, sanitize(tag.name_en));
                  if (fs.pathExistsSync(enDir)) {
                    fs.removeSync(enDir);
                  }
                }

                if (tag.name_ja) {
                  const jaDir = path.join(conDir, sanitize(tag.name_ja));
                  if (fs.pathExistsSync(jaDir)) {
                    fs.removeSync(jaDir);
                  }
                }
              }

              for (let conOkNgDir of conOkNgDirs) {
                if (tag.name_en) {
                  const enOkNgDir = path.join(conOkNgDir, sanitize(tag.name_en));
                  if (fs.pathExistsSync(enOkNgDir)) {
                    fs.removeSync(enOkNgDir);
                  }
                }

                if (tag.name_ja) {
                  const jaOkNgDir = path.join(conOkNgDir, sanitize(tag.name_ja));
                  if (fs.pathExistsSync(jaOkNgDir)) {
                    fs.removeSync(jaOkNgDir);
                  }
                }
              }

              // DB から削除
              try {
                if (tag.name_en) {
                  await ddb.deleteItem(tabName, tag.name_en);
                }

                if (tag.name_ja) {
                  await ddb.deleteItem(tabName, tag.name_ja);
                }

                logger.debug('not Artist and not Studio', tag.name_ja, tag.name_en);
              } catch(err) {
                logger.error('deleteItem', JSON.stringify(err));
              }
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
const confirmType = process.argv[2];

if (confirmType) {
  exports.dbConfirm(confirmType);
} else {
  console.info('Usage: node ' + path.basename(process.argv[1]) +
      ' <confirmType (Download/Ignore)>');
}
