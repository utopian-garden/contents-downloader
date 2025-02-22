import fs from 'fs-extra';
import path from 'path';

// 設定ファイル
import appConfig from '../config/app-config.json' with { type: 'json' };

// 定義
const dir = appConfig.fs.dir;
const tab = appConfig.db.tab;

const emptyMove = async (dlType) => {
  let targetDir;
  let targetNgDir;
  switch (dlType) {
    case tab.igTable:
      targetDir = dir.igDir;
      targetNgDir = dir.igNgDir;
      break;
  }

  const targetDirs = fs.readdirSync(targetDir);

  for (let targetDir of targetDirs) {
    const tagDir = path.join(targetDir, targetDir);
    const tagNgDir = path.join(targetNgDir, targetDir);
    const contents = fs.readdirSync(tagDir);

    if (!contents.length && tagDir !== '_ng') {
      fs.moveSync(tagDir, tagNgDir, { overwrite: true });
    }
  }
};

const dlType = process.argv[2];

if (dlType) {
  emptyMove(dlType);
} else {
  console.info('Usage: node ' + path.basename(process.argv[1]) +
    ' <dlType (Ignore)>');
}
