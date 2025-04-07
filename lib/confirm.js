// 依存パッケージ
import consoleStamp from 'console-stamp-color';
import fs from 'fs-extra';
import log4js from 'log4js';
import path from 'path';
import sanitize from 'sanitize-filename';

consoleStamp(console, {
  format: ':date(yyyy/mm/dd HH:MM:ss.l) :label'
});

// ライブラリ
import { scanAll, updateItem, deleteItem } from './ddb.js';
import { searchPost, refreshTokens } from './req.js';
import { getTokens } from './auth.js';

// 設定ファイル
import appConfig from '../config/app-config.json' with { type: 'json' };

// 定義
const { lastAttr } = appConfig.db.attr;
const { dlImageDir, dlVideoDir, dlImageOkDir, dlVideoOkDir, igDir, igNgDir } = appConfig.fs.dir;
const { shortPoll, middlePoll, longPoll } = appConfig.req.poll;
const { dlTable, igTable } = appConfig.db.tab;

// DB のディレクトリの修正処理
const dbConfirm = async (confirmType) => {
  let tabName;
  let conDirs;

  // 引数によるパラメータ設定
  switch (confirmType) {
    case dlTable:
      log4js.configure('./config/con-dl-log-config.json');
      tabName = dlTable;
      conDirs = [dlImageDir, dlVideoDir, dlImageOkDir, dlVideoOkDir];
      break;

    case igTable:
      log4js.configure('./config/con-ig-log-config.json');
      tabName = igTable;
      conDirs = [igDir, igNgDir];
      break;
  }

  // 初期化
  const logger = log4js.getLogger('system');

  // 認証リクエスト
  let accessToken, refreshToken;
  try {
    accessToken, refreshToken = await getTokens();
  } catch (err) {
    logger.error('getTokens', err.message);
    return;
  }

  // ループ処理開始
  const tabItems = await scanAll(tabName);
  for (let tabItem of tabItems) {
    const { tag: tagKey } = tabItem;

    // ページ数でループ
    let pageNum = 1;
    let next;

    page_loop:
    while (2 > pageNum) {
      console.info(tagKey, pageNum);

      let searchRes;

      if (pageNum > 1 && !next) {
        break page_loop;
      }

      // 検索リクエスト
      try {
        searchRes = await searchPost(tagKey, pageNum, next, accessToken);

        await waitTimer(shortPoll);
      } catch (err) {
        if (!err.response) {
          logger.error('searchPost', tagKey, pageNum, err.code);
          await waitTimer(shortPoll);
          continue page_loop;
        }

        logger.error('searchPost', tagKey, pageNum, err.response.status);

        switch (err.response.status) {
          case 401:
            try {
              accessToken, refreshToken = await refreshTokens(refreshToken);
            } catch (err) {
              logger.error('refreshTokens', err.message);
              return;
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

      const { data: searchData, meta: searchMeta } = searchRes;
      next = searchMeta.next;

      // 続行条件のチェック
      if (searchData && searchData.length === 0) {
        logger.debug('nothing', tagKey, pageNum);
        break;
      }

      // 検索結果でループ
      for (let item of searchData) {
        for (let tag of item.tags) {
          const { name_ja: jaName, tagName, type } = tag;
          if (!jaName || !tagName) {
            continue;
          }
          const saniTagEn = sanitize(tagName);
          const saniTagJp = sanitize(jaName);

          // 日本語タグの英語化
          if (
            !tagKey.match(/^[\x20-\x7e]*$/) && jaName === tagKey && tagName !== tagKey &&
            tagName !== null
          ) {
            // DB に追加
            try {
              await updateItem(tabName, tagName, lastAttr, 0);
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
              await deleteItem(tabName, jaName);
              logger.debug('dbConfirm', jaName, tagName);
            } catch (err) {
              logger.error('deleteItem', JSON.stringify(err));
            }
          }

          // artist でも studio でもないタグの削除
          if ((tagName === tagKey) && type !== 1 && type !== 2) {
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
              if (tagName) {
                await deleteItem(tabName, tagName);
              }

              if (jaName) {
                await deleteItem(tabName, jaName);
              }

              logger.debug('not Artist and not Studio', jaName, tagName);
            } catch (err) {
              logger.error('deleteItem', JSON.stringify(err));
            }
          }
        }
      }

      pageNum++;
    }
  }
};

// Wait 処理
const waitTimer = (quePoll) => {
  return new Promise((resolve) => {
    setTimeout(resolve, quePoll * 1000);
  });
};

// メイン処理の起動
const confirmType = process.argv[2];

if (confirmType) {
  dbConfirm(confirmType);
} else {
  console.info('Usage: node ' + path.basename(process.argv[1]) +
    ' <confirmType (Download/Ignore)>');
}
