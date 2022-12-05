const fs = require('fs-extra');
const path = require('path');

const appConfig = require('../config/app-config.json');

exports.emptyMove = async (dlType) => {
  const igTable = appConfig.db.tab.igTable;
  const artTable = appConfig.db.tab.artTable;
  const stuTable = appConfig.db.tab.stuTable;

  let targetDir;
  let targetNgDir;
  switch(dlType) {
    case igTable:
      targetDir = appConfig.fs.igDir;
      targetNgDir = appConfig.fs.igNgDir;
      break;

    case artTable:
      targetDir = appConfig.fs.artDir;
      targetNgDir = appConfig.fs.artNgDir;
      break;

    case stuTable:
      targetDir = appConfig.fs.stuDir;
      targetNgDir = appConfig.fs.stuNgDir;
      break;
  }

  const dirs = fs.readdirSync(targetDir);

  for (let dir of dirs) {
    const tagDir = path.join(targetDir, dir);
    const tagNgDir = path.join(targetNgDir, dir);
    const contents = fs.readdirSync(tagDir);

    if (!contents.length && dir !== '_ng') {
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
