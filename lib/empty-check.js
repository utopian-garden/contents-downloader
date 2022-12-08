const fs = require('fs-extra');
const path = require('path');

// 設定ファイル
const appConfig = require('../config/app-config.json');

// 定義
const tab = appConfig.db.tab;
const dir = appConfig.fs.dir;

exports.emptyMove = async (dlType) => {
  let targetDir;
  let targetNgDir;
  switch(dlType) {
    case tab.igTable:
      targetDir = dir.igDir;
      targetNgDir = dir.igNgDir;
      break;

    case tab.artTable:
      targetDir = dir.artDir;
      targetNgDir = dir.artNgDir;
      break;

    case tab.stuTable:
      targetDir = dir.stuDir;
      targetNgDir = dir.stuNgDir;
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
}

const dlType = process.argv[2];

if (dlType) {
  exports.emptyMove(dlType);
} else {
  console.info('Usage: node ' + path.basename(process.argv[1]) +
      ' <dlType (Ignore/Artist/Studio)>');
}
