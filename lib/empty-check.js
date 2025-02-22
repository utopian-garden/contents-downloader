import fs from 'fs-extra';
import path from 'path';

// 設定ファイル
import appConfig from '../config/app-config.json' with { type: 'json' };

// 定義
const { igDir, igNgDir } = appConfig.fs.dir;
const { igTable } = appConfig.db.tab;

const emptyMove = async (dlType) => {
  let targetDir;
  let targetNgDir;
  switch (dlType) {
    case igTable:
      targetDir = igDir;
      targetNgDir = igNgDir;
      break;
  }

  const tagDirs = fs.readdirSync(targetDir);

  for (let tagName of tagDirs) {
    const tagDir = path.join(targetDir, tagName);
    const tagNgDir = path.join(targetNgDir, tagName);
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
  console.info('Usage: node ' + path.basename(process.argv[1]) + ' <dlType (Ignore)>');
}
