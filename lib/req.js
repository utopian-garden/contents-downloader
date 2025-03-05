// 依存パッケージ
import axios from 'axios';
import consoleStamp from 'console-stamp-color';
import fs from 'fs-extra';
import got from 'got';

consoleStamp(console, {
  format: ':date(yyyy/mm/dd HH:MM:ss.l) :label'
});

// 設定ファイル
import appConfig from '../config/app-config.json' with { type: 'json' };

// 定義
const { authUrl, authPrefix, userName, passWord } = appConfig.req.auth;
const { userAgent } = appConfig.req.header;
const { middlePoll } = appConfig.req.poll;
const {
  rateSearchUrl, postSearchUrl, postSearchParam, postSearchParamNext, refererUrl
} = appConfig.req.search;
const { voteUrl, voteParam } = appConfig.req.vote;
const { tagUrl, tagParam } = appConfig.req.tag;

// AuthToken の取得
const getToken = async () => {
  const authOptions = {
    method: 'POST',
    url: authUrl,
    headers: {
      'User-Agent': userAgent
    },
    json: true,
    data: {
      login: userName,
      password: passWord
    },
    timeout: middlePoll * 1000
  };

  return authPrefix + (await axios.request(authOptions)).data.access_token;
};

// ポストの検索
const searchPost = async (tagKey, pageNum, next, authToken) => {
  let url = postSearchUrl + encodeURIComponent(tagKey) + postSearchParam + pageNum;
  if (next) {
    url += postSearchParamNext + next;
  }
  const searchOptions = {
    method: 'GET',
    url: url,
    headers: {
      'User-Agent': userAgent,
      'Authorization': authToken,
      'Referer': refererUrl
    },
    timeout: middlePoll * 1000
  };

  return (await axios.request(searchOptions)).data;
};

// ポストのコンテンツダウンロード
const dlContent = async (filePath, fileUrl, refererUrl) => {
  let fileSize = 0;

  const tempFilePath = filePath + '.temp';

  if (fs.existsSync(tempFilePath)) {
    fileSize = fs.statSync(tempFilePath).size;
  }

  const headers = {
    'User-Agent': userAgent,
    'Referer': refererUrl,
    'Range': `bytes=${fileSize}-`,
  };

  const writer = fs.createWriteStream(tempFilePath, { flags: 'a' });

  const downloadStream = got.stream(fileUrl, { headers });

  downloadStream.pipe(writer);

  return new Promise((resolve, reject) => {
    downloadStream.on('end', async () => {
      writer.close();
      await new Promise(resolve => setTimeout(resolve, 100));
      if (!fs.existsSync(tempFilePath)) {
        return reject(new Error(`Temp file not found before rename: ${tempFilePath}`));
      }
      fs.renameSync(tempFilePath, filePath);
      resolve();
    });
    downloadStream.on('error', async (err) => {
      writer.close();
      if (!fs.existsSync(tempFilePath)) {
        return reject(new Error(`Download failed and temp file was removed: ${tempFilePath}`));
      }
      reject(err);
    });
    writer.on('error', async (err) => {
      reject(err);
    });
  });
};

// ポストのタグ追加
const tagPut = async (postId, reqJson, authToken) => {
  const url = tagUrl + postId + tagParam;
  const tagOptions = {
    method: 'PUT',
    url: url,
    headers: {
      'User-Agent': userAgent,
      'Authorization': authToken
    },
    json: true,
    data: reqJson,
    timeout: middlePoll * 1000
  };

  const result = (await axios.request(tagOptions)).data;
  console.info(JSON.stringify({ 'success': result.success }));
};

// レートの検索
const searchRate = async (postId, authToken) => {
  const url = rateSearchUrl + postId;
  const searchOptions = {
    method: 'GET',
    url: url,
    headers: {
      'User-Agent': userAgent,
      'Authorization': authToken
    },
    timeout: middlePoll * 1000
  };

  return (await axios.request(searchOptions)).data;
};

// ポストの投票
const postVote = async (postId, reqJson, authToken) => {
  const url = voteUrl + postId + voteParam;
  const voteOptions = {
    method: 'PUT',
    url: url,
    headers: {
      'User-Agent': userAgent,
      'Authorization': authToken,
    },
    json: true,
    data: reqJson,
    timeout: middlePoll * 1000
  };

  const result = (await axios.request(voteOptions)).data;
  console.info(JSON.stringify({ 'success': result.success }));
};

export { getToken, dlContent, tagPut, searchRate, searchPost, postVote };
