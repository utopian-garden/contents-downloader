// 依存パッケージ
import consoleStamp from 'console-stamp-color';
import fs from 'fs-extra';
import log4js from 'log4js';
import path from 'path';

consoleStamp(console, {
  format: ':date(yyyy/mm/dd HH:MM:ss.l) :label'
});

// ライブラリ
import req from './req.js';

// 設定ファイル
import appConfig from '../config/app-config.json' with { type: 'json' };

// 定義
const reqPoll = appConfig.req.poll;
const dir = appConfig.fs.dir;

// ポストのお気に入り処理
const ratePosts = async () => {
  // 初期化
  log4js.configure('./config/rate-log-config.json');
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

  const safeDirs = [dir.dlImageSafeDir, dir.dlVideoSafeDir];

  for (let safeDir of safeDirs) {
    const safeFiles = fs.readdirSync(safeDir);

    for (let file of safeFiles) {
      const postId = file.split('.')[0];

      console.info(postId);

      // Post に対してレーティングを上書き
      try {
        // レーティング含むタグを取得
        const searchRes = await req.searchRate(postId, authToken);
        const item = searchRes[0];

        const parentId = item.parent_id;
        const source = item.source;
        const tags = item.tags;

        const reqJson = {
          id: postId,
          post: {
            lang: 'en',
            parent_id: parentId,
            rating: 's',
            source: source,
            tags: tags
          }
        };

        // レーティング含むタグを上書き
        await req.tagPut(postId, reqJson, authToken);
        fs.removeSync(path.join(safeDir, file));
      } catch (err) {
        if (!err.response) {
          logger.error('tagPut', postId, err.code);
          await waitTimer(reqPoll.shortPoll);
          continue;
        }

        switch (err.response.status) {
          case 401:
            logger.error('tagPut', postId, err.response.status);
            try {
              authToken = await req.getToken();
            } catch (err) {
              logger.error('getToken', err.message);
            }
            continue;

          default:
            logger.error('tagPut', postId, err.response.status);
            await waitTimer(reqPoll.shortPoll);
            continue;
        }
      }
    }
  }
};

// Wait 処理
const waitTimer = (quePoll) => {
  return new Promise((resolve) => {
    setTimeout(resolve, quePoll * 1000);
  });
};

ratePosts();
