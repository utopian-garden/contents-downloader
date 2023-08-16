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

// 定義
const attr = appConfig.db.attr;
const dir = appConfig.fs.dir;
const reqPoll = appConfig.req.poll;
const search = appConfig.req.search;
const tab = appConfig.db.tab;

// DB のディレクトリの修正処理
exports.dbConfirm = async (confirmType) => {
  let tabName;
  let conDirs;

  // 引数によるパラメータ設定
  switch (confirmType) {
    case tab.dlTable:
      log4js.configure('./config/con-dl-log-config.json');
      tabName = tab.dlTable;
      conDirs = [
        dir.dlImageDir,
        dir.dlVideoDir,
        dir.dlImageOkDir,
        dir.dlVideoOkDir
      ];
      break;

    case tab.igTable:
      log4js.configure('./config/con-ig-log-config.json');
      tabName = tab.igTable;
      conDirs = [
        dir.igDir,
        dir.igNgDir
      ];
      break;
  }

  // 初期化
  const logger = log4js.getLogger('system');

  // 認証リクエスト
  let authToken;
  while (!authToken) {
    try {
      authToken = await req.getToken();
    } catch (err) {
      logger.error('getToken', err.message);
      await waitTimer(reqPoll.longPoll);
    }
  }

  // ループ処理開始
  const tabItems = await ddb.scanAll(tabName);
  for (let tabItem of tabItems) {
    const tagKey = tabItem.tag;

    // ページ数でループ
    let pageNum = 1;

    page_loop:
    while (2 > pageNum) {
      console.info(tagKey, pageNum);

      // 検索リクエスト
      let searchRes;
      try {
        searchRes = await req.searchPost(
          tagKey, pageNum, search.conSearchParam, authToken);

        await waitTimer(reqPoll.shortPoll);
      } catch (err) {
        if (!err.response) {
          logger.error('searchPost', tagKey, pageNum, err.code);
          await waitTimer(reqPoll.shortPoll);
          continue page_loop;
        }

        logger.error('searchPost', tagKey, pageNum, err.response.status);

        switch (err.response.status) {
          case 401:
            try {
              authToken = await req.getToken();
            } catch (err) {
              logger.error('getToken', err.message);
            }
            continue page_loop;

          case 429:
            await waitTimer(reqPoll.longPoll);
            continue page_loop;

          case 502:
          case 503:
            await waitTimer(reqPoll.middlePoll);
            continue page_loop;

          default:
            await waitTimer(reqPoll.shortPoll);
            continue page_loop;
        }
      }

      // 続行条件のチェック
      if (searchRes) {
        if (searchRes.length === 0) {
          logger.debug('nothing', tagKey, search.searchUrl +
            encodeURIComponent(tagKey) + search.conSearchParam + pageNum);
          break;
        }

        // 検索結果でループ
        for (let item of searchRes) {
          for (let tag of item.tags) {
            if (!tag.name_ja || !tag.name_en) {
              continue;
            }
            const saniTagEn = sanitize(tag.name_en);
            const saniTagJp = sanitize(tag.name_ja);

            // 日本語タグの英語化
            if (!tagKey.match(/^[\x20-\x7e]*$/) && tag.name_ja === tagKey &&
              tag.name_en !== tagKey && tag.name_en !== null) {

              // DB に追加
              try {
                await ddb.updateItem(tabName, tag.name_en, attr.lastAttr, 0);
              } catch (err) {
                logger.error('updateItem', JSON.stringify(err));
              }

              // フォルダのリネーム
              for (let conDir of conDirs) {
                const enDir = path.join(conDir, saniTagEn);
                const jaDir = path.join(conDir, saniTagJp);
                if (fs.pathExistsSync(jaDir) && saniTagEn && saniTagJp) {
                  fs.moveSync(jaDir, enDir, { overwrite: true });
                }
              }

              // DB から削除
              try {
                await ddb.deleteItem(tabName, tag.name_ja);
                logger.debug('dbConfirm', tag.name_ja, tag.name_en);
              } catch (err) {
                logger.error('deleteItem', JSON.stringify(err));
              }
            }

            // artist でも studio でもないタグの削除
            if ((tag.name_en === tagKey || tag.name_ja === tagKey) &&
              tag.type !== 1 && tag.type !== 2) {

              // フォルダの削除
              for (let conDir of conDirs) {
                if (saniTagEn) {
                  const enDir = path.join(conDir, saniTagEn);
                  if (fs.pathExistsSync(enDir)) {
                    fs.removeSync(enDir);
                  }
                }

                if (saniTagJp) {
                  const jaDir = path.join(conDir, saniTagJp);
                  if (fs.pathExistsSync(jaDir)) {
                    fs.removeSync(jaDir);
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

                logger.debug('not Artist and not Studio',
                  tag.name_ja, tag.name_en);
              } catch (err) {
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
