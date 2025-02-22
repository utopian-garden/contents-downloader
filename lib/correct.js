// 依存パッケージ
import consoleStamp from 'console-stamp-color';

consoleStamp(console, {
  format: ':date(yyyy/mm/dd HH:MM:ss.l) :label'
});

// ライブラリ
import ddb from './ddb.js';

// 設定ファイル
import appConfig from '../config/app-config.json' with { type: 'json' };

// 定義
const tab = appConfig.db.tab;

// DB修正
const dupCorrect = async () => {
  // Download のスキャン
  const dlItems = await ddb.scanAll(tab.dlTable);
  const dlTags = dlItems.map(item => { return item.tag; });

  // Ignore のスキャン
  const igItems = await ddb.scanAll(tab.igTable);
  const igTags = igItems.map(item => { return item.tag; });

  // 内容比較で重複があった場合はテーブルから削除
  for (let dlTag of dlTags) {
    // DL タグが Ignore テーブルにある場合は削除
    if (igTags.includes(dlTag)) {
      await ddb.deleteItem(tab.igTable, dlTag);
    }
  }
};

const correct = { dupCorrect };
export default correct;
