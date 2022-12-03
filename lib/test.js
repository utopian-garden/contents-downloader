const fs = require('fs-extra');
const appConfig = require('../config/app-config.json');

exports.test = async () => {
  const ngText = appConfig.ng.ngText;
  const testJson = fs.readFileSync('./log/test.json', 'utf-8');
  const json = JSON.parse(testJson);

  console.time('my-timer');

  check_loop:
  for (let item of json) {
    for (let tag of item.tags) {
      if (ngText.includes(tag.name_en)) {
        console.log(tag.name_en);
        continue check_loop;
      }
    }
  }

  console.timeEnd('my-timer');
}

exports.test();
