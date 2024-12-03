// 依存パッケージ
import consoleStamp from 'console-stamp-color';
import log4js from 'log4js';
import path from 'path';

consoleStamp(console, {
  format: ':date(yyyy/mm/dd HH:MM:ss.l) :label'
});

// ライブラリ
import ddb from './ddb.js';
import req from './req.js';
import sqs from './sqs.js';

// 設定ファイル
import appConfig from '../config/app-config.json' assert { type: 'json' };

// 定義
const attr = appConfig.db.attr;
const ext = appConfig.fs.ext;
const msg = appConfig.mq.msg;
const ng = appConfig.ng;
const quePoll = appConfig.mq.poll;
const queUrl = appConfig.mq.url;
const reqPoll = appConfig.req.poll;
const tab = appConfig.db.tab;
const threshold = appConfig.mq.threshold;

// ポストのダウンロード処理
const quePosts = async (dlType) => {
  // 初期化
  log4js.configure('./config/download-log-config.json');
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
  let waitCount = 0;
  let loop = true;

  search_loop:
  while (loop) {
    // 優先キューからメッセージを取得
    let tagMsg;
    try {
      tagMsg = await sqs.recvMsg(queUrl.priorDlQueUrl);
    } catch (err) {
      logger.error('recvMsg', queUrl.priorDlQueUrl, err);
      await waitTimer(quePoll.dlQuePoll);
    }

    // 通常キューからメッセージを取得
    const dlQueUrl = queUrl.dlQueUrl;
    if (!tagMsg) {
      try {
        tagMsg = await sqs.recvMsg(dlQueUrl);
      } catch (err) {
        logger.error('recvMsg', dlQueUrl, err);
        await waitTimer(quePoll.dlQuePoll);
      }
    }

    // メッセージを取得できない場合は後続をスキップしてメッセージ待ち
    if (!tagMsg) {
      waitCount++;

      if (waitCount === 1) {
        console.info(msg.waitingMsg);
      }

      await waitTimer(quePoll.dlQuePoll);

      continue search_loop;
    }

    waitCount = 0;

    // DB の整合性チェック
    const tagKey = tagMsg.tag;
    let tabItems;
    try {
      tabItems = await ddb.getItem(tab.dlTable, tagKey);
    } catch (err) {
      logger.error('getItem', JSON.stringify(err));
      continue;
    }

    if (!tabItems.Item) {
      continue;
    }

    // 最終更新の取得
    let curLast = Number(tagMsg.last);
    if (!curLast || dlType === 'Full') {
      curLast = 0;
    }

    // Tag テーブルのタグの postid を削除
    if (dlType === 'Full') {
      await ddb.deleteItem(tab.tagTable, tagKey);
      await ddb.updateItem(tab.tagTable, tagKey, attr.postAttr, []);
    }

    // ページ数でループ
    let pageNum = 1;
    let next;
    let searchQueCnt = 0;

    page_loop:
    while (loop) {
      let searchRes;

      try {
        searchQueCnt = await sqs.cntMsg(queUrl.searchQueUrl);
      } catch (err) {
        logger.error('cntMsg');
        await waitTimer(quePoll.dlQuePoll);
        continue page_loop;
      }

      if (searchQueCnt >= threshold.searchQueMax) {
        await waitTimer(quePoll.dlQuePoll);
        continue page_loop;
      }

      console.info(tagKey, pageNum);

      // 検索リクエスト
      try {
        searchRes = await req.searchPost(tagKey, pageNum, next, authToken);

        await waitTimer(reqPoll.shortPoll);
      } catch (err) {
        if (!err.response || !err.response.status) {
          logger.error('searchFork', tagKey, pageNum, err.message);
          continue page_loop;
        }

        switch (err.response.status) {
          case 401:
            // 検索が 401 エラーの場合はアクセストークンを再取得する
            try {
              authToken = await req.getToken();
            } catch (err) {
              logger.error('getToken', err.message);
            }
            continue page_loop;

          case 429:
            // 戻り値がリトライ対象であった場合は、リトライする
            await waitTimer(reqPoll.longPoll);
            continue page_loop;

          case 502:
          case 503:
            // 戻り値がスキップ対象であった場合は、次のタグへ移行する
            await waitTimer(reqPoll.middlePoll);
            break page_loop;

          default:
            await waitTimer(reqPoll.shortPoll);
            continue page_loop;
        }
      }

      const searchData = searchRes.data;
      const searchMeta = searchRes.meta;
      next = searchMeta.next;

      if (searchData && searchData.length === 0) {
        break page_loop;
      }

      const dlItems = [];
      const postArray = [];

      // そうでない場合は Tag テーブルの post に追加する postid を配列に追加する
      check_loop:
      for (let post of searchData) {
        // last の値が Post ID を上回った場合はスキップ対象とする
        if (curLast >= post.id) {
          break page_loop;
        }

        // Post ID と拡張子の NG チェック
        const ignoreExts = ext.ignoreExts;
        const fileUrl = post.file_url;
        const fileExt = (fileUrl.match(/.*\.(.*)\?.*/))[1];
        if (ng.ngId.includes(post.id) || ignoreExts.includes(fileExt)) {
          continue check_loop;
        }

        // タグの NG チェック
        for (let tag of post.tags) {
          if (ng.ngText.includes(tag.name_en)) {
            continue check_loop;
          }
        }

        // チェックをクリアしたらダウンロード対象として追加
        postArray.push(post.id);
        dlItems.push(post);
      }

      // Tag テーブルに postid の配列を追加する
      try {
        await ddb.addArrayItem(tab.tagTable, tagKey, attr.postAttr, postArray);
      } catch (err) {
        logger.error('addArrayItem', JSON.stringify(err));
      }

      // 1 ページ目の 1 つ目の Post ID は last としてテーブルに書き込む
      if (pageNum === 1) {
        try {
          const newLast = searchData[0].id;
          await ddb.updateItem(tab.dlTable, tagKey, attr.lastAttr, newLast);
        } catch (err) {
          logger.error('updateItem', JSON.stringify(err));
        }
      }

      // 検索結果をリクエストキューに送信する
      const msgBody = {
        tagKey: tagKey,
        pageNum: pageNum,
        curLast: curLast,
        msgData: dlItems
      };

      if (msgBody) {
        try {
          await sqs.sendMsg(queUrl.searchQueUrl, JSON.stringify(msgBody));
        } catch (err) {
          logger.error('sendMsg', queUrl.searchQueUrl, pageNum, err.message);
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

const dlType = process.argv[2];

if (dlType) {
  quePosts(dlType);
} else {
  console.info('Usage: node ' + path.basename(process.argv[1]) +
    ' <Download Type (Full/Diff)>');
}
