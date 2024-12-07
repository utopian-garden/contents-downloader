'use ristrict';

// 依存パッケージ
import consoleStamp from 'console-stamp-color';
import fs from 'fs-extra';
import log4js from 'log4js';
import path from 'path';

consoleStamp(console, {
  format: ':date(yyyy/mm/dd HH:MM:ss.l) :label'
});

// 設定ファイル
import appConfig from '../config/app-config.json' with { type: 'json' };

// 定義
const dir = appConfig.fs.dir;

// 初期化
log4js.configure('./config/exempt-log-config.json');
const logger = log4js.getLogger('system');

const okExempt = async (exemptType) => {
  let params;

  // 引数によるパラメータ設定の分岐
  switch (exemptType) {
    case 'Image':
      params = {
        fromOkDir: dir.dlVideoOkDir,
        targetDir: dir.dlImageDir,
        targetOkDir: dir.dlImageOkDir,
      };

      break;
    case 'Video':
      params = {
        fromOkDir: dir.dlImageOkDir,
        targetDir: dir.dlVideoDir,
        targetOkDir: dir.dlVideoOkDir,
      };

      break;
  }

  // 既存タグフォルダの取得
  const fromTags = fs.readdirSync(params.fromOkDir);
  const targetTags = fs.readdirSync(params.targetDir);

  // タグフォルダ毎にループ処理
  for (let targetTag of targetTags) {
    if (targetTag === '_ok' || targetTag === '_ng') {
      continue;
    }

    // 対向 (_image であれば _video/ok) に同名のフォルダが存在する場合は
    // 要否チェックを免除してサブディレクトリ (_image であれば _image/ok) に移動
    if (fromTags.includes(targetTag)) {
      const targetDir = path.join(params.targetDir, targetTag);
      const targetOkDir = path.join(params.targetOkDir, targetTag);

      try {
        fs.moveSync(targetDir, targetOkDir, { overwrite: true });
        logger.debug(targetTag);
      } catch (err) {
        logger.error('okExempt', targetDir, targetOkDir);
      }
    }
  }
};

// メイン処理の起動
const exemptType = process.argv[2];

if (exemptType) {
  okExempt(exemptType);
} else {
  console.info('Usage: node ' + path.basename(process.argv[1]) +
    ' <exemptType (Image/Video)>');
}
