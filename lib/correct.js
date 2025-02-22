// 依存パッケージ
import consoleStamp from 'console-stamp-color';

consoleStamp(console, {
  format: ':date(yyyy/mm/dd HH:MM:ss.l) :label'
});

// ライブラリ
import { scanAll, deleteItem } from './ddb.js';

// 設定ファイル
import appConfig from '../config/app-config.json' with { type: 'json' };

// 定義
const { dlTable, igTable } = appConfig.db.tab;

// DB修正
const dupCorrect = async () => {
  // Download のスキャン
  const dlItems = await scanAll(dlTable);
  const dlTags = dlItems.map(item => { return item.tag; });

  // Ignore のスキャン
  const igItems = await scanAll(igTable);
  const igTags = igItems.map(item => { return item.tag; });

  // 内容比較で重複があった場合はテーブルから削除
  for (let dlTag of dlTags) {
    // DL タグが Ignore テーブルにある場合は削除
    if (igTags.includes(dlTag)) {
      await deleteItem(igTable, dlTag);
    }
  }
};

export { dupCorrect };
