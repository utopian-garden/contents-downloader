// 依存パッケージ
import consoleStamp from 'console-stamp-color';
import fs from 'fs-extra';
import log4js from 'log4js';
import path from 'path';

consoleStamp(console, {
  format: ':date(yyyy/mm/dd HH:MM:ss.l) :label'
});

// ライブラリ
import { getToken, tagPut, searchRate } from './req.js';

// 設定ファイル
import appConfig from '../config/app-config.json' with { type: 'json' };

// 定義
const { shortPoll, longPoll } = appConfig.req.poll;
const { dlImageSafeDir, dlVideoSafeDir } = appConfig.fs.dir;

// ポストのお気に入り処理
const ratePosts = async () => {
  // 初期化
  log4js.configure('./config/rate-log-config.json');
  const logger = log4js.getLogger('system');

  // 認証リクエスト
  let authToken;
  while (!authToken) {
    try {
      authToken = await getToken();
    } catch (err) {
      logger.error('getToken', err.message);
      await waitTimer(longPoll);
    }
  }

  const safeDirs = [dlImageSafeDir, dlVideoSafeDir];

  for (let safeDir of safeDirs) {
    const safeFiles = fs.readdirSync(safeDir);

    for (let file of safeFiles) {
      const postId = file.split('.')[0];

      console.info(postId);

      // Post に対してレーティングを上書き
      try {
        // レーティング含むタグを取得
        const searchRes = await searchRate(postId, authToken);
        const item = searchRes[0];

        const { parent_id: parentId, source, tags } = item;

        const reqJson = {
          id: postId,
          post: {
            lang: 'en',
            parent_id: parentId,
            rating: 'q',
            source: source,
            tags: tags
          }
        };

        // レーティング含むタグを上書き
        await tagPut(postId, reqJson, authToken);
        fs.removeSync(path.join(safeDir, file));
      } catch (err) {
        if (!err.response) {
          logger.error('tagPut', postId, err.code);
          await waitTimer(shortPoll);
          continue;
        }

        switch (err.response.status) {
          case 401:
            logger.error('tagPut', postId, err.response.status);
            try {
              authToken = await getToken();
            } catch (err) {
              logger.error('getToken', err.message);
            }
            continue;

          default:
            logger.error('tagPut', postId, err.response.status);
            await waitTimer(shortPoll);
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
